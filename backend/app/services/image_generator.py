"""Image generator service using OpenAI's GPT Image API."""

import base64
from typing import Any

from openai import AsyncOpenAI

from app.config import settings


class ImageGenerator:
    """Generates profile images for AI agents using OpenAI's image generation."""

    def __init__(self) -> None:
        self.client = AsyncOpenAI(api_key=settings.openai_api_key)

    def _build_image_prompt(self, persona: dict[str, Any]) -> str:
        """
        Build an image generation prompt based on the persona.
        """
        image_type = persona.get("profile_image_type", "professional")
        description = persona.get("profile_image_description", "")

        if description:
            # Use the provided description as base
            base_prompt = description
        else:
            # Generate based on image type
            name = persona.get("name", "person")
            location = persona.get("location", {})
            personal = persona.get("personal", {})
            hobbies = personal.get("hobbies", [])
            pet = personal.get("pet")

            if image_type == "professional":
                base_prompt = f"Professional headshot photograph of a friendly software developer, natural lighting, office or neutral background, warm smile, casual business attire"

            elif image_type == "vacation":
                locations = [
                    "on a beach", "in the mountains", "at a famous landmark",
                    "in a beautiful city", "in nature"
                ]
                import random
                loc = random.choice(locations)
                base_prompt = f"Candid vacation photo of a person {loc}, natural lighting, genuine smile, travel photography style"

            elif image_type == "hobby":
                hobby = hobbies[0] if hobbies else "reading"
                base_prompt = f"Candid photo of a person enjoying {hobby}, natural setting, authentic moment, warm lighting"

            elif image_type == "pet":
                pet_type = pet.get("type", "dog") if pet else "dog"
                base_prompt = f"Warm photo of a person with their {pet_type}, genuine affection, natural lighting, lifestyle photography"

            elif image_type == "artistic":
                base_prompt = f"Creative portrait photo with interesting lighting or composition, artistic style, unique angle or background"

            else:
                base_prompt = f"Natural photograph of a friendly person, warm lighting, genuine expression"

        # Add style guidelines
        style_suffix = ", high quality, photorealistic, shot on professional camera, natural colors"

        return base_prompt + style_suffix

    async def generate_profile_image(self, persona: dict[str, Any]) -> bytes | None:
        """
        Generate a profile image for an agent.

        Returns the image as bytes, or None if generation fails.
        """
        if not settings.openai_api_key:
            return None

        prompt = self._build_image_prompt(persona)

        try:
            response = await self.client.images.generate(
                model="gpt-image-1",
                prompt=prompt,
                size="1024x1024",
                quality="medium",
                n=1,
            )

            # Get base64 image data
            if response.data and response.data[0].b64_json:
                return base64.b64decode(response.data[0].b64_json)

            return None

        except Exception as e:
            # Log error but don't fail
            print(f"Image generation failed: {e}")
            return None

    async def generate_placeholder_avatar(self, name: str) -> bytes:
        """
        Generate a simple placeholder avatar with initials.
        This is a fallback when image generation is not available.

        Returns a simple SVG as bytes.
        """
        # Get initials
        parts = name.split()
        initials = "".join(p[0].upper() for p in parts[:2])

        # Generate a consistent color based on name
        hash_val = sum(ord(c) for c in name)
        hue = hash_val % 360

        svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
  <rect width="200" height="200" fill="hsl({hue}, 65%, 55%)"/>
  <text x="100" y="100" font-family="Arial, sans-serif" font-size="80" font-weight="bold"
        fill="white" text-anchor="middle" dominant-baseline="central">{initials}</text>
</svg>'''

        return svg.encode("utf-8")
