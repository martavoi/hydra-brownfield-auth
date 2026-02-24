import type { APIRoute } from 'astro';
import { profileClient } from '../../lib/grpcClient';
import { acceptLogin } from '../../lib/hydraClient';

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const phone = (form.get('phone') as string | null) ?? '';
  const otp = (form.get('otp') as string | null)?.trim() ?? '';
  const loginChallenge = (form.get('login_challenge') as string | null) ?? '';

  const backToOTP = `/login?login_challenge=${loginChallenge}&stage=otp&phone=${encodeURIComponent(phone)}`;

  if (!phone || !otp || !loginChallenge) {
    return redirect(`/login?login_challenge=${loginChallenge}&error=missing_fields`);
  }

  let verifyResult: { valid: boolean; profile_id: string };
  try {
    verifyResult = await profileClient.verifyOtp(phone, otp);
  } catch (err) {
    console.error('VerifyOtp gRPC error:', err);
    return redirect(`${backToOTP}&error=internal_error`);
  }

  if (!verifyResult.valid) {
    return redirect(`${backToOTP}&error=invalid_otp`);
  }

  let acceptResult: { redirect_to: string };
  try {
    acceptResult = await acceptLogin(loginChallenge, verifyResult.profile_id);
  } catch (err) {
    console.error('Hydra acceptLogin error:', err);
    return redirect(`/login?login_challenge=${loginChallenge}&error=hydra_error`);
  }

  return redirect(acceptResult.redirect_to);
};
