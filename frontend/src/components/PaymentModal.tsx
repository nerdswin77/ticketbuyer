import { CardElement, Elements, useElements, useStripe } from '@stripe/react-stripe-js';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { getStripe } from '../lib/stripe';
import type { AppConfig, Profile } from '../types';
import { Modal } from './Modal';

interface Props {
  config: AppConfig;
  profile: Profile;
  onSaved: (p: Profile) => void;
  onClose: () => void;
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
const cssVar = (name: string, fallback: string) =>
  getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

export function PaymentModal({ config, profile, onSaved, onClose }: Props) {
  const [replacing, setReplacing] = useState(!profile.has_payment_method);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    try {
      onSaved(await api.removePaymentMethod());
      setReplacing(true);
    } catch (err) {
      setError(errMsg(err));
    }
  };
  const saved = (p: Profile) => {
    onSaved(p);
    onClose();
  };

  return (
    <Modal title="Payment method" onClose={onClose}>
      <p className="muted small">
        Auto-buy charges this card <b>off-session</b> the instant seats are held, with no checkout page.
        {config.gateway === 'stripe'
          ? ' Card details go straight to Stripe and never touch our server.'
          : ' Mock gateway: only a token and the last 4 digits are stored.'}
      </p>
      {profile.has_payment_method && !replacing ? (
        <div className="saved-card">
          <div>
            <b>{profile.card_brand?.toUpperCase()}</b> •••• {profile.card_last4}
            <div className="muted small">Expires {profile.card_exp}</div>
          </div>
          <div className="row">
            <button onClick={() => setReplacing(true)}>Replace</button>
            <button className="danger" onClick={remove}>
              Remove
            </button>
          </div>
        </div>
      ) : config.gateway === 'stripe' && config.stripe_publishable_key ? (
        <Elements stripe={getStripe(config.stripe_publishable_key)}>
          <StripeCardForm profile={profile} onSaved={saved} />
        </Elements>
      ) : config.gateway === 'stripe' ? (
        <div className="form-error">STRIPE_PUBLISHABLE_KEY is not configured on the server.</div>
      ) : (
        <MockCardForm defaultName={profile.full_name} onSaved={saved} />
      )}
      {error && <div className="form-error">{error}</div>}
    </Modal>
  );
}

const TEST_CARDS = [
  { label: 'Success', number: '4242 4242 4242 4242' },
  { label: 'Declined', number: '4000 0000 0000 0002' },
  { label: 'No funds', number: '4000 0000 0000 9995' },
  { label: '3-D Secure', number: '4000 0025 0000 3155' },
];

function MockCardForm({ defaultName, onSaved }: { defaultName: string; onSaved: (p: Profile) => void }) {
  const [card, setCard] = useState({ number: '', exp: '', cvc: '', name: defaultName });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const m = /^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/.exec(card.exp.trim());
    if (!m) return setError('Expiry must be MM/YY');
    const year = Number(m[2]!.length === 2 ? `20${m[2]}` : m[2]);
    setSaving(true);
    setError(null);
    try {
      await api.setupPaymentMethod();
      onSaved(
        await api.saveMockCard({
          number: card.number.replace(/\s/g, ''),
          exp_month: Number(m[1]),
          exp_year: year,
          cvc: card.cvc,
          name: card.name,
        }),
      );
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <div className="test-cards">
        <span className="muted small">Test cards:</span>
        {TEST_CARDS.map((t) => (
          <button
            type="button"
            key={t.number}
            className="mini"
            onClick={() => setCard({ ...card, number: t.number, exp: '12/30', cvc: '123' })}
          >
            {t.label}
          </button>
        ))}
      </div>
      <label>
        Card number
        <input
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4242 4242 4242 4242"
          value={card.number}
          onChange={(e) => setCard({ ...card, number: e.target.value })}
          required
        />
      </label>
      <div className="row">
        <label className="grow">
          Expiry
          <input placeholder="MM/YY" value={card.exp} onChange={(e) => setCard({ ...card, exp: e.target.value })} required />
        </label>
        <label className="grow">
          CVC
          <input
            inputMode="numeric"
            placeholder="123"
            value={card.cvc}
            onChange={(e) => setCard({ ...card, cvc: e.target.value })}
            required
          />
        </label>
      </div>
      <label>
        Name on card
        <input value={card.name} onChange={(e) => setCard({ ...card, name: e.target.value })} />
      </label>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save card'}
        </button>
      </div>
    </form>
  );
}

function StripeCardForm({ profile, onSaved }: { profile: Profile; onSaved: (p: Profile) => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api
      .setupPaymentMethod()
      .then((r) => setClientSecret(r.client_secret))
      .catch((err) => setError(errMsg(err)));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const card = elements?.getElement(CardElement);
    if (!stripe || !card || !clientSecret) return;
    setSaving(true);
    setError(null);
    try {
      const res = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card, billing_details: { name: profile.full_name || undefined, email: profile.email || undefined } },
      });
      if (res.error) throw new Error(res.error.message);
      onSaved(await api.saveStripeCard(res.setupIntent.id));
    } catch (err) {
      setError(errMsg(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <div className="stripe-card">
        <CardElement
          options={{
            style: { base: { color: cssVar('--text', '#0f172a'), fontSize: '15px', '::placeholder': { color: cssVar('--muted', '#64748b') } } },
          }}
        />
      </div>
      <p className="muted small">Stripe test mode: use 4242 4242 4242 4242, any future date and any CVC.</p>
      {error && <div className="form-error">{error}</div>}
      <div className="form-actions">
        <button type="submit" className="primary" disabled={!stripe || !clientSecret || saving}>
          {saving ? 'Saving…' : 'Save card'}
        </button>
      </div>
    </form>
  );
}
