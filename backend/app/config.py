from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite:///./kickoff.db"

    stripe_secret_key: str = ""
    stripe_publishable_key: str = ""
    stripe_webhook_secret: str = ""

    currency: str = "eur"
    cors_origins: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]

    max_tickets_per_order: int = 6
    hold_seconds: int = 120
    purchase_timeout_seconds: float = 20.0
    arm_lead_ms: int = 2000

    simulate_rivals: bool = True
    demo_reset_on_start: bool = True
    # Mock gateway only: pre-save the 4242 test Visa so purchases work out of the box
    seed_test_card: bool = True

    # Optional: import complete real league schedules from football-data.org (free key at football-data.org)
    football_data_api_key: str = ""
    football_data_base_url: str = "https://api.football-data.org/v4"

    # Simulated fixture announcements: one unannounced fixture is published every N seconds
    fixture_feed_enabled: bool = True
    fixture_first_publish_s: float = 20
    fixture_publish_interval_s: float = 45
    # Ticket sale opens this many seconds after a fixture is announced (random in range)
    fixture_sale_lead_min_s: int = 60
    fixture_sale_lead_max_s: int = 180

    @property
    def stripe_enabled(self) -> bool:
        return bool(self.stripe_secret_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
