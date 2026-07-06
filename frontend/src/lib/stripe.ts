import { loadStripe, type Stripe } from '@stripe/stripe-js';

let promise: Promise<Stripe | null> | null = null;
let loadedKey: string | null = null;

export function getStripe(publishableKey: string): Promise<Stripe | null> {
  if (!promise || loadedKey !== publishableKey) {
    loadedKey = publishableKey;
    promise = loadStripe(publishableKey);
  }
  return promise;
}
