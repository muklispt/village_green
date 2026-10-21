from pathlib import Path
from PIL import Image,UnidentifiedImageError
from rest_framework.exceptions import ValidationError


ALLOWED_IMAGE_FORMATS = {'JPEG', 'PNG', 'WEBP'}
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024  # 5MB
MAX_IMAGE_SIDE = 6000  # 6000px

ALLOWED_VIDEO_EXTENSIONS = {'.mp4', '.webm'}
MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024  # 50MB
MP4_MAGIC_BYTES = b'ftyp'
WEBM_MAGIC_BYTES = b'\x1a\x45\xdf\xa3'

MAX_IMAGES_PER_PRODUCT = 10
MAX_IMAGE_PER_PRODUCT = MAX_IMAGES_PER_PRODUCT

def validate_product_image_file(file):
    """
    Validates uploaded product image:
    - File size <= 5MB
    - Image format in JPEG, PNG, WEBP
    - Dimensions (width, height) <= 6000px
    - Valid and uncorrupted via Pillow verify()
    """
    if file.size > MAX_IMAGE_SIZE_BYTES:
        raise ValidationError("Image size must not exceed 5MB.")

    try:
        img = Image.open(file)
        img_format = (img.format or '').upper()
        width, height = img.size
        img.verify()
    except (UnidentifiedImageError,OSError,SyntaxError,ValueError):
        raise ValidationError("upload a valid image file.")
    finally:
        if hasattr(file, 'seek'):
            file.seek(0)

    if img_format not in ALLOWED_IMAGE_FORMATS:
        raise ValidationError("Only JPEG, PNG, and WebP images are allowed.")

    if max(width,height)> MAX_IMAGE_SIDE:
        raise ValidationError("Image dimensions must not exceed 6000px in width or height.")

    return file


def validate_product_video_file(file):
    """
    Validates uploaded promotional video file:
    - File size <= 50MB
    - File extension is .mp4 or .webm
    - Magic bytes match ISO BMFF ('ftyp' at offset 4) for MP4 or EBML for WebM
    - No external dependencies required
    """
    if file.size > MAX_VIDEO_SIZE_BYTES:
        raise ValidationError("Video size must not exceed 50MB.")

    ext = Path(file.name).suffix.lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise ValidationError("Only MP4 and WebM video files are allowed.")

    try:
        header = file.read(12)
    except Exception as exc:
        raise ValidationError(f"Unable to read video file: {str(exc)}")
    finally:
        if hasattr(file, 'seek'):
            file.seek(0)

    if len(header) < 4:
        raise ValidationError("Invalid or empty video file.")

    if ext == '.mp4':
        if len(header) < 8 or header[4:8] != MP4_MAGIC_BYTES:
            raise ValidationError("Invalid MP4 file: missing standard ISO MP4 header.")
    elif ext == '.webm':
        if not header.startswith(WEBM_MAGIC_BYTES):
            raise ValidationError("Invalid WebM file: missing standard EBML header.")

    return file
