import pytest

from triage.data import load_training


@pytest.fixture(scope="session")
def training():
    return load_training()
