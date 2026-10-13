"""Urdu must survive profile and generation request validation unchanged."""

import pytest
from pydantic import ValidationError

from backend.models import GenerationRequest, SpeakRequest, VoiceProfileCreate


class TestUrduRequests:
    def test_create_urdu_profile(self):
        profile = VoiceProfileCreate(name="Urdu voice", language="ur", default_engine="omnivoice")
        assert profile.language == "ur"

    def test_generate_urdu_text(self):
        text = "السلام علیکم۔ آج موسم بہت خوشگوار ہے۔"  # noqa: RUF001 -- Urdu punctuation
        request = GenerationRequest(profile_id="urdu-profile", text=text, language="ur", engine="omnivoice")
        assert request.language == "ur"
        assert request.text == text
        assert request.model_dump()["engine"] == "omnivoice"

    def test_unknown_language_still_rejected(self):
        with pytest.raises(ValidationError):
            GenerationRequest(profile_id="profile", text="Hello", language="zz", engine="omnivoice")

    def test_speak_request_accepts_urdu(self):
        request = SpeakRequest(text="السلام علیکم", language="ur")
        assert request.language == "ur"
