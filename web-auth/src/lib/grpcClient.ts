import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

const PROTO_PATH = process.env.PROTO_PATH ?? '/proto/profile/profile.proto';
const PROFILE_SRV_ADDR = process.env.PROFILE_SRV_ADDR ?? 'profile-srv:50051';

const packageDefinition = protoLoader.loadSync(PROTO_PATH, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const protoDescriptor = grpc.loadPackageDefinition(packageDefinition) as any;
const ProfileService = protoDescriptor.profile.ProfileService;

// Singleton gRPC client — one connection for the process lifetime
const client = new ProfileService(
  PROFILE_SRV_ADDR,
  grpc.credentials.createInsecure(),
);

function call<T>(method: string, request: object): Promise<T> {
  return new Promise((resolve, reject) => {
    client[method](request, (err: grpc.ServiceError | null, res: T) => {
      if (err) reject(err);
      else resolve(res);
    });
  });
}

export interface UserProfile {
  id: string;
  phone: string;
  fname: string;
  lname: string;
  email: string;
  address: string;
}

export const profileClient = {
  requestOtp: (phone: string) =>
    call<{ sent: boolean }>('RequestOtp', { phone }),

  verifyOtp: (phone: string, otp: string) =>
    call<{ valid: boolean; profile_id: string }>('VerifyOtp', { phone, otp }),

  getById: (id: string) =>
    call<{ profile: UserProfile }>('GetById', { id }),

  getByPhone: (phone: string) =>
    call<{ profile: UserProfile }>('GetByPhone', { phone }),
};
