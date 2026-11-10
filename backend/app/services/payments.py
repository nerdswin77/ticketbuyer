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


class MockGateway(PaymentGateway):
    """Behaves like Stripe's test cards:
    4242 4242 4242 4242 succeeds · 4000 0000 0000 0002 declined ·
    4000 0000 0000 9995 insufficient funds · 4000 0025 0000 3155 requires 3-D Secure
    """

    name = "mock"
    _BEHAVIOUR = {
        "4000000000000002": "decline",
        "4000000000009995": "funds",
        "4000002500003155": "3ds",
    }

    def __init__(self) -> None:
        self._payments: dict[str, ChargeStatus] = {}

    def create_setup(self, customer_id, email, name) -> SetupResult:
        return SetupResult(customer_id=customer_id or f"cus_mock_{secrets.token_hex(6)}", client_secret=None)

    def attach(self, customer_id, payload: PaymentMethodIn) -> CardInfo:
        card = payload.mock_card
        if card is None:
            raise PaymentError("Card details are required")
        number = "".join(ch for ch in card.number if ch.isdigit())
        if not 12 <= len(number) <= 19 or not _luhn_ok(number):
            raise PaymentError("Card number is invalid")
        today = date.today()
        if (card.exp_year, card.exp_month) < (today.year, today.month):
            raise PaymentError("Card has expired")
        behaviour = self._BEHAVIOUR.get(number, "ok")
        return CardInfo(
            payment_method_id=f"pm_mock_{behaviour}_{secrets.token_hex(4)}",
            brand=_brand(number),
            last4=number[-4:],
            exp=f"{card.exp_month:02d}/{card.exp_year}",
        )

    def charge(self, *, customer_id, payment_method_id, amount_cents, currency, idempotency_key, description, metadata):
        pid = f"pi_mock_{secrets.token_hex(8)}"
        behaviour = payment_method_id.split("_")[2] if payment_method_id.startswith("pm_mock_") else "decline"
        if behaviour == "decline":
            return ChargeResult("failed", pid, "Your card was declined.")
        if behaviour == "funds":
            return ChargeResult("failed", pid, "Your card has insufficient funds.")
        if behaviour == "3ds":
            self._payments[pid] = "requires_action"
            return ChargeResult("requires_action", pid, client_secret=f"{pid}_secret_mock")
        self._payments[pid] = "succeeded"
        return ChargeResult("succeeded", pid)

    def confirm(self, payment_id: str) -> ChargeResult:
        # In the mock, "confirm" is the simulated 3-D Secure approval.
        if payment_id not in self._payments:
            return ChargeResult("failed", payment_id, "Unknown payment")
        self._payments[payment_id] = "succeeded"
        return ChargeResult("succeeded", payment_id)

    def refund(self, payment_id: str) -> None:
        if self._payments.get(payment_id) != "succeeded":
            raise PaymentError("Payment cannot be refunded")
        self._payments[payment_id] = "failed"


# --------------------------------------------------------------------------- stripe

class StripeGateway(PaymentGateway):
    name = "stripe"

    def __init__(self, secret_key: str) -> None:
        stripe.api_key = secret_key

    def create_setup(self, customer_id, email, name) -> SetupResult:
        try:
            if not customer_id:
                customer_id = stripe.Customer.create(email=email or None, name=name or None).id
            si = stripe.SetupIntent.create(customer=customer_id, usage="off_session", payment_method_types=["card"])
            return SetupResult(customer_id=customer_id, client_secret=si.client_secret)
        except stripe.StripeError as e:
            raise PaymentError(e.user_message or str(e)) from e

    def attach(self, customer_id, payload: PaymentMethodIn) -> CardInfo:
        if not payload.setup_intent_id:
            raise PaymentError("setup_intent_id is required")
        try:
            si = stripe.SetupIntent.retrieve(payload.setup_intent_id)
            if si.status != "succeeded" or not si.payment_method:
                raise PaymentError(f"Card setup not completed (status: {si.status})")
            if customer_id and si.customer != customer_id:
                raise PaymentError("Setup belongs to a different customer")
            pm = stripe.PaymentMethod.retrieve(si.payment_method)
            stripe.Customer.modify(si.customer, invoice_settings={"default_payment_method": pm.id})
            return CardInfo(pm.id, pm.card.brand, pm.card.last4, f"{pm.card.exp_month:02d}/{pm.card.exp_year}")
        except stripe.StripeError as e:
            raise PaymentError(e.user_message or str(e)) from e

    @staticmethod
    def _map(pi: Any) -> ChargeResult:
        status = pi["status"]
        if status == "succeeded":
            return ChargeResult("succeeded", pi["id"])
        if status == "processing":
            return ChargeResult("processing", pi["id"])
        if status == "requires_action":
            return ChargeResult("requires_action", pi["id"], client_secret=pi["client_secret"])
        err = (pi.get("last_payment_error") or {}).get("message") or f"Payment {status}"
        return ChargeResult("failed", pi["id"], err)

    def charge(self, *, customer_id, payment_method_id, amount_cents, currency, idempotency_key, description, metadata):
        try:
            pi = stripe.PaymentIntent.create(
                amount=amount_cents,
                currency=currency,
                customer=customer_id,
                payment_method=payment_method_id,
                off_session=True,
                confirm=True,
                description=description,
                metadata=metadata,
                idempotency_key=idempotency_key,
            )
            return self._map(pi)
        except stripe.CardError as e:
            err = e.error
            pi = getattr(err, "payment_intent", None)
            if err and err.code == "authentication_required" and pi:
                return ChargeResult("requires_action", pi["id"], client_secret=pi["client_secret"])
            return ChargeResult("failed", pi["id"] if pi else None, e.user_message or str(e))
        except stripe.StripeError as e:
            log.exception("stripe charge failed")
            return ChargeResult("failed", None, e.user_message or "Payment provider error")

    def confirm(self, payment_id: str) -> ChargeResult:
        try:
            return self._map(stripe.PaymentIntent.retrieve(payment_id))
        except stripe.StripeError as e:
            return ChargeResult("failed", payment_id, e.user_message or str(e))

    def refund(self, payment_id: str) -> None:
        try:
            stripe.Refund.create(payment_intent=payment_id)
        except stripe.StripeError as e:
            raise PaymentError(e.user_message or str(e)) from e


_gateway: PaymentGateway | None = None


def get_gateway() -> PaymentGateway:
    global _gateway
    if _gateway is None:
        _gateway = StripeGateway(settings.stripe_secret_key) if settings.stripe_enabled else MockGateway()
    return _gateway
