import getpass
import os

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from rest_framework.exceptions import ValidationError as DEFValidationError
from django.core.management.base import BaseCommand,CommandError


class Command(BaseCommand):
    help = 'Create an admin-panel accout (staff,role=admin) without a superuser by default.'

    def add_arguments(self, parser):
        parser.add_argument('--email',required=True)
        parser.add_argument('--name',required=True,help='Full name')
        parser.add_argument('--superuser',action='store_true',
                            help='Also grant Django superuser rights (all permissions)')
        parser.add_argument('--password-env',metavar='VAR',
                            help='Read the password from this environment variable of prompting')
        
    def handle(self, *args, **options):
        User = get_user_model()
        email = User.objects.normalize_email(options['email']).strip().lower()

        if User.objects.filter(email=email).exists():
            raise CommandError(f'A user with email {email} already exists.')

        if options['password_env']:
            password = os.environ.get(options['password_env'],'')
            if not password:
                raise CommandError(f'Environment variable {options['password_env']} is empty.')
        else:
            password = getpass.getpass('Password: ')
            if password !=getpass.getpass('Password (again): '):
                raise CommandError('Password do not match.')

        try:
            validate_password(password)
        except ValidationError as exc:
            raise CommandError(' '.join(exc.messages))
        except DEFValidationError as exc:
            raise CommandError(' '.join(str(item) for item in exc.detail))

        user = User(
            email=email,
            full_name=options['name'].strip(),
            role = 'admin',
            is_staff=True,
            is_active=True,
            is_superuser =options['superuser'],
        )
        user.set_password(password)
        user.save()
        self.stdout.write(self.style.SUCCESS(f'Admin created: {email}'))
        