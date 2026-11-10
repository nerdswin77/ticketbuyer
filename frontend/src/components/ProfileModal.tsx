import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Profile } from '../types';
import { Modal } from './Modal';

interface Props {
  profile: Profile;
  onSaved: (p: Profile) => void;
  onClose: () => void;
}

export function ProfileModal({ profile, onSaved, onClose }: Props) {
  const [form, setForm] = useState({ full_name: profile.full_name, email: profile.email, fan_id: profile.fan_id });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(await api.updateProfile(form));
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Buyer profile" onClose={onClose}>
      <form onSubmit={submit} className="form">
        <p className="muted small">Saved on the server so checkout needs no typing when the sale opens.</p>
        <label>
          Full name (as on ticket)
          <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} maxLength={120} />
        </label>
        <label>
          Email
          <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </label>
        <label>
          Club membership / fan ID (optional)
          <input value={form.fan_id} onChange={(e) => setForm({ ...form, fan_id: e.target.value })} maxLength={64} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <div className="form-actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
