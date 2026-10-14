import re
from rest_framework.validators import ValidationError

class CustomPasswordValidator:

     def validate(self, password, user=None):

        if not re.search(r'[A-Z]', password):
            raise ValidationError(
                'Password must contain an uppercase letter.'
            )

        if not re.search(r'[a-z]', password):
            raise ValidationError(
                'Password must contain a lowercase letter.'
            )

        if not re.search(r'[0-9]', password):
            raise ValidationError(
                'Password must contain a number.'
            )

        if not re.search(r'[^A-Za-z0-9]', password):
            raise ValidationError(
                'Password must contain a special character.'
            )

     def get_help_text(self):
        return (
            'Password must contain at least 8 characters, '
            'including uppercase, lowercase, number and special character.'
        )
    