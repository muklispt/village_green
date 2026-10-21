from rest_framework import serializers


class AdminLoginSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(write_only=True,max_length=128,trim_whitespace=False)

    def validate_email(self,value):
        return value.strip().lower()

    