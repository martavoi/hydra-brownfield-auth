import type { APIRoute } from 'astro';
import { profileClient } from '../../lib/grpcClient';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const phone = (form.get('phone') as string | null)?.trim() ?? '';
  const loginChallenge = (form.get('login_challenge') as string | null) ?? '';

  if (!phone || !loginChallenge) {
    return redirect(`/login?login_challenge=${loginChallenge}&error=missing_fields`);
  }

  try {
    await profileClient.requestOtp(phone);
  } catch (err) {
    console.error('RequestOtp error:', err);
    return redirect(`/login?login_challenge=${loginChallenge}&error=otp_send_failed`);
  }

  return redirect(
    `/login?login_challenge=${loginChallenge}&stage=otp&phone=${encodeURIComponent(phone)}`,
  );
};
