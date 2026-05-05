"""Payment gateways.

Card numbers never reach our backend when Stripe is active (Stripe Elements tokenises
in the browser). The mock gateway accepts test numbers but only stores a token,
brand and last 4 digits - never the PAN or CVC.
"""

from __future__ import annotations

import logging
import secrets
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

import stripe

from ..config import settings
from ..schemas import PaymentMethodIn

log = logging.getLogger("kickoff.payments")

ChargeStatus = Literal["succeeded", "requires_action", "failed", "processing"]


class PaymentError(Exception):
    pass


@dataclass
class SetupResult:
    customer_id: str | None
    client_secret: str | None


@dataclass
class CardInfo:
    payment_method_id: str
    brand: str
    last4: str
    exp: str  # MM/YYYY


@dataclass
class ChargeResult:
    status: ChargeStatus
    payment_id: str | None = None
    error: str | None = None
    client_secret: str | None = None


class PaymentGateway(ABC):
    name: str

    @abstractmethod
    def create_setup(self, customer_id: str | None, email: str, name: str) -> SetupResult: ...

    @abstractmethod
    def attach(self, customer_id: str | None, payload: PaymentMethodIn) -> CardInfo: ...

    @abstractmethod
    def charge(
        self,
        *,
        customer_id: str | None,
        payment_method_id: str,
        amount_cents: int,
        currency: str,
        idempotency_key: str,
        description: str,
        metadata: dict[str, str],
    ) -> ChargeResult: ...

    @abstractmethod
    def confirm(self, payment_id: str) -> ChargeResult:
        """Re-check a payment after customer authentication."""

    @abstractmethod
    def refund(self, payment_id: str) -> None: ...


# --------------------------------------------------------------------------- mock

def _luhn_ok(number: str) -> bool:
    total, alt = 0, False
    for ch in reversed(number):
        d = int(ch)
        if alt:
            d = d * 2 - 9 if d > 4 else d * 2
        total += d
        alt = not alt
    return total % 10 == 0


def _brand(number: str) -> str:
    if number.startswith("4"):
        return "visa"
    if number[:2] in {"51", "52", "53", "54", "55"} or 2221 <= int(number[:4]) <= 2720:
        return "mastercard"
    if number[:2] in {"34", "37"}:
        return "amex"
    return "card"

