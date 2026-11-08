"""Management command to cancel unpaid online orders after an expiry threshold and restock items.

Scheduling Guide:
- In Linux / production: Schedule via cron (e.g. `crontab -e`):
  */5 * * * * /path/to/venv/bin/python /path/to/backend/manage.py expire_unpaid_orders >> /var/log/green_village_expiry.log 2>&1
- In Windows / dev: Run manually or via Windows Task Scheduler.
- Or trigger periodically from a systemd timer.
"""

from datetime import timedelta
import logging
from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from orders.models import Order, OrderStatus, Payment, PaymentMethod, PaymentStatus
from orders import services

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Expire unpaid online orders that have exceeded the time threshold and restore deducted stock."

    def add_arguments(self, parser):
        parser.add_argument(
            "--minutes",
            type=int,
            default=30,
            help="Threshold in minutes after which an unpaid online order expires (default: 30).",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=100,
            help="Maximum number of orders to expire in a single run (default: 100).",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Simulate the expiry process without altering the database.",
        )

    def handle(self, *args, **options):
        minutes = options["minutes"]
        limit = options["limit"]
        dry_run = options["dry_run"]

        if minutes < 1:
            self.stderr.write(self.style.ERROR("The --minutes threshold must be at least 1."))
            return

        cutoff = timezone.now() - timedelta(minutes=minutes)

        candidate_ids = list(
            Order.objects.filter(
                payment_method=PaymentMethod.ONLINE,
                status=OrderStatus.PENDING,
                payment__status__in=[PaymentStatus.PENDING, PaymentStatus.FAILED],
                created_at__lte=cutoff,
            )
            .values_list("id", flat=True)[:limit]
        )

        if not candidate_ids:
            self.stdout.write(self.style.SUCCESS(f"No expired unpaid online orders found (cutoff={cutoff.isoformat()})."))
            return

        self.stdout.write(f"Found {len(candidate_ids)} candidate order(s) placed before {cutoff.isoformat()}.")

        expired_count = 0
        skipped_count = 0

        for order_id in candidate_ids:
            if dry_run:
                order = Order.objects.filter(pk=order_id).first()
                if order:
                    self.stdout.write(f"[DRY-RUN] Would expire order #{order.order_number} (placed at {order.created_at})")
                    expired_count += 1
                continue

            try:
                with transaction.atomic():
                    # Acquire row locks to ensure safe serialization against concurrent webhooks
                    order = Order.objects.select_for_update().get(pk=order_id)
                    payment = Payment.objects.select_for_update().get(order=order)

                    # Re-verify eligibility under row lock
                    if (
                        order.payment_method != PaymentMethod.ONLINE
                        or order.status != OrderStatus.PENDING
                        or payment.status == PaymentStatus.PAID
                    ):
                        self.stdout.write(f"Skipping order #{order.order_number}: state changed concurrently (status={order.status}, payment={payment.status}).")
                        skipped_count += 1
                        continue

                    # Cancel order and restore stock exactly once
                    services._cancel_locked(
                        order,
                        actor=None,
                        note=f"Automatically expired after {minutes} minutes without payment confirmation.",
                    )
                    expired_count += 1
                    self.stdout.write(self.style.SUCCESS(f"Successfully expired order #{order.order_number} and restored stock."))

            except Exception as exc:
                logger.error("Failed to expire order %s: %s", order_id, exc)
                self.stderr.write(self.style.ERROR(f"Error expiring order {order_id}: {exc}"))

        mode_str = " (DRY RUN)" if dry_run else ""
        self.stdout.write(
            self.style.SUCCESS(f"Summary{mode_str}: {expired_count} expired, {skipped_count} skipped.")
        )

