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

