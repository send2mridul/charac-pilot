"""Voice catalog endpoint — built-in stock voices for MVP."""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()


class VoiceCatalogItem(BaseModel):
    voice_id: str
    display_name: str
    description: str
    suggested_use: str


VOICE_CATALOG: list[VoiceCatalogItem] = [
    VoiceCatalogItem(
        voice_id="warm_female",
        display_name="Warm Female",
        description="Smooth and warm alto voice with natural cadence.",
        suggested_use="Female leads, narrators, gentle characters",
    ),
    VoiceCatalogItem(
        voice_id="young_male",
        display_name="Young Male",
        description="Energetic young male tenor, slightly casual.",
        suggested_use="Male leads, supporting cast, dialogue-heavy roles",
    ),
    VoiceCatalogItem(
        voice_id="narrator_deep",
        display_name="Narrator Deep",
        description="Deep, authoritative baritone with measured pacing.",
        suggested_use="Narrators, intros, voiceover, documentary",
    ),
    VoiceCatalogItem(
        voice_id="cute_child",
        display_name="Cute Child",
        description="Light, bright child voice with playful energy.",
        suggested_use="Child characters, playful sidekicks",
    ),
    VoiceCatalogItem(
        voice_id="villain_dark",
        display_name="Villain Dark",
        description="Low, menacing voice with slow deliberate pacing.",
        suggested_use="Antagonists, mysterious figures, dark narration",
    ),
]


@router.get("/catalog", response_model=list[VoiceCatalogItem])
def get_voice_catalog():
    return VOICE_CATALOG
