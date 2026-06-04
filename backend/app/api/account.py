import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..db import get_db
from ..events import bus
from sqlalchemy import select

from ..models import BuyerProfile, League
from ..schemas import FavoritesIn, PaymentMethodIn, PreferencesIn, ProfileOut, ProfileUpdate, SetupOut
from ..services.payments import PaymentError, get_gateway
from ..services.purchase import get_profile

router = APIRouter(prefix="/api", tags=["account"])


def profile_out(p: BuyerProfile) -> ProfileOut:
    active = bool(p.payment_method_id) and p.gateway == get_gateway().name
    return ProfileOut(
        full_name=p.full_name,
        email=p.email,
        fan_id=p.fan_id,
        gateway=p.gateway,
        card_brand=p.card_brand if active else None,
        card_last4=p.card_last4 if active else None,
        card_exp=p.card_exp if active else None,
        has_payment_method=active,
        favorite_leagues=p.favorite_leagues,
        fixture_alerts=p.fixture_alerts,  # type: ignore[arg-type]
        auto_preorder_favorites=p.auto_preorder_favorites,
        auto_preorder_quantity=p.auto_preorder_quantity,
    )


@router.put("/profile/preferences", response_model=ProfileOut)
async def set_preferences(body: PreferencesIn, db: Session = Depends(get_db)) -> ProfileOut:
    p = get_profile(db)
    p.fixture_alerts = body.fixture_alerts
    p.auto_preorder_favorites = body.auto_preorder_favorites
    p.auto_preorder_quantity = body.auto_preorder_quantity
    db.commit()
    bus.log(
        "info",
        f"Fixture alerts: {body.fixture_alerts}"
        + (f" · auto pre-order {body.auto_preorder_quantity} tickets for favourite leagues" if body.auto_preorder_favorites else ""),
    )
    return profile_out(p)


@router.put("/profile/favorites", response_model=ProfileOut)
async def set_favorites(body: FavoritesIn, db: Session = Depends(get_db)) -> ProfileOut:
    """Replace the buyer's favourite competitions (order preserved, duplicates removed)."""
    known = set(db.scalars(select(League.id)))
    unknown = [lid for lid in body.leagues if lid not in known]
    if unknown:
        raise HTTPException(422, f"Unknown leagues: {', '.join(unknown)}")
    p = get_profile(db)
    p.favorite_leagues = list(dict.fromkeys(body.leagues))
    db.commit()
    return profile_out(p)


@router.get("/profile", response_model=ProfileOut)
async def read_profile(db: Session = Depends(get_db)) -> ProfileOut:
    return profile_out(get_profile(db))


@router.put("/profile", response_model=ProfileOut)
async def update_profile(body: ProfileUpdate, db: Session = Depends(get_db)) -> ProfileOut:
    p = get_profile(db)
    p.full_name, p.email, p.fan_id = body.full_name.strip(), body.email.strip(), body.fan_id.strip()
    db.commit()
    bus.log("ok", "Buyer profile saved")
    return profile_out(p)


@router.post("/payment-methods/setup", response_model=SetupOut)
async def setup_payment_method(db: Session = Depends(get_db)) -> SetupOut:
    gw = get_gateway()
    p = get_profile(db)
    customer = p.customer_id if p.gateway == gw.name else None
    try:
        res = await asyncio.to_thread(gw.create_setup, customer, p.email, p.full_name)
    except PaymentError as e:
        raise HTTPException(502, str(e)) from e
    p.customer_id, p.gateway = res.customer_id, gw.name
    db.commit()
    return SetupOut(gateway=gw.name, client_secret=res.client_secret)


@router.post("/payment-methods", response_model=ProfileOut)
async def save_payment_method(body: PaymentMethodIn, db: Session = Depends(get_db)) -> ProfileOut:
    gw = get_gateway()
    p = get_profile(db)
    if p.gateway != gw.name or not p.customer_id:
        raise HTTPException(409, "Call /payment-methods/setup first")
    try:
        card = await asyncio.to_thread(gw.attach, p.customer_id, body)
    except PaymentError as e:
        raise HTTPException(400, str(e)) from e
    p.payment_method_id, p.card_brand, p.card_last4, p.card_exp = card.payment_method_id, card.brand, card.last4, card.exp
    db.commit()
    bus.log("ok", f"Payment method saved: {card.brand.upper()} •••• {card.last4}")
    return profile_out(p)


@router.delete("/payment-methods", response_model=ProfileOut)
async def remove_payment_method(db: Session = Depends(get_db)) -> ProfileOut:
    p = get_profile(db)
    p.payment_method_id = p.card_brand = p.card_last4 = p.card_exp = None
    db.commit()
    bus.log("warn", "Payment method removed. Auto-buy will fail until a card is added")
    return profile_out(p)
