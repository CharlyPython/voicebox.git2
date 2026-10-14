"""Tests for generation request engine selection."""

import pytest
from pydantic import ValidationError

from backend import models


def _request(**kwargs) -> models.GenerationRequest:
    return models.GenerationRequest(profile_id="profile-1", text="hello", **kwargs)


def test_omitted_engine_does_not_override_profile_default():
    request = _request()

    assert request.engine is None


def test_explicit_engine_is_preserved():
    request = _request(engine="chatterbox")

    assert request.engine == "chatterbox"


def test_invalid_explicit_engine_is_rejected():
    with pytest.raises(ValidationError):
        _request(engine="invalid")


@pytest.mark.parametrize("engine", ["voxcpm2", "omnivoice", "qwen_voice_design"])
def test_omitted_engine_uses_saved_profile_preference(engine):
    from types import SimpleNamespace

    from backend.routes.generations import _resolve_generation_engine

    profile = SimpleNamespace(default_engine=engine, voice_type="cloned", preset_engine=None)
    assert _resolve_generation_engine(_request(), profile) == engine


@pytest.mark.parametrize("engine", ["voxcpm2", "omnivoice"])
def test_cloned_profiles_accept_both_multilingual_engines(engine):
    from types import SimpleNamespace

    from backend.services.profiles import validate_profile_engine

    validate_profile_engine(SimpleNamespace(voice_type="cloned"), engine)
