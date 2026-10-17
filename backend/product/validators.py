from PIL import Image
from rest_framework.exceptions import ValidationError


ALLOWED_IMAGE_FORMATS = {'JPEG', 'PNG', 'WEBP'}
MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024  # 5MB
MAX_DIMENSION_PX = 6000  # 6000px


def validate_product_image_file(file):
    """
    Validates uploaded product image:
    - File size <= 5MB
    - Image format in JPEG, PNG, WEBP
    - Dimensions (width, height) <= 6000px
    - Valid and uncorrupted via Pillow verify()
    """
    if file.size > MAX_FILE_SIZE_BYTES:
        raise ValidationError("Image size must not exceed 5MB.")

    try:
        img = Image.open(file)
        img_format = (img.format or '').upper()
        width, height = img.size
        img.verify()
    except Exception as exc:
        raise ValidationError(f"Invalid or corrupted image file: {str(exc)}")
    finally:
        if hasattr(file, 'seek'):
            file.seek(0)

    if img_format not in ALLOWED_IMAGE_FORMATS:
        raise ValidationError("Only JPEG, PNG, and WebP images are allowed.")

    if width > MAX_DIMENSION_PX or height > MAX_DIMENSION_PX:
        raise ValidationError("Image dimensions must not exceed 6000px in width or height.")

    return file
