package service

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"log"
	"math/big"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/hydra-auth/profile-srv/internal/repository"
	pb "github.com/hydra-auth/profile-srv/proto/profile"
)

var _ pb.ProfileServiceServer = (*ProfileService)(nil) // compile-time interface check

// SmsSender delivers an OTP code to a phone number.
// Implementations are expected to be non-blocking (e.g. run in a goroutine).
type SmsSender func(phone, code string)

// ProfileService implements the gRPC ProfileService server.
type ProfileService struct {
	pb.UnimplementedProfileServiceServer
	profiles repository.ProfileRepository
	otps     repository.OtpRepository
	sendSms  SmsSender
	otpTtl   int
}

func NewProfileService(
	profiles repository.ProfileRepository,
	otps repository.OtpRepository,
	sendSms SmsSender,
	otpTtl int,
) *ProfileService {
	return &ProfileService{
		profiles: profiles,
		otps:     otps,
		sendSms:  sendSms,
		otpTtl:   otpTtl,
	}
}

func (s *ProfileService) Register(ctx context.Context, req *pb.RegisterRequest) (*pb.RegisterResponse, error) {
	if req.Phone == "" {
		return nil, status.Error(codes.InvalidArgument, "phone is required")
	}
	p, err := s.profiles.Create(ctx, req.Phone, req.Fname, req.Lname, req.Email, req.Address)
	if errors.Is(err, repository.ErrConflict) {
		return nil, status.Error(codes.AlreadyExists, "phone already registered")
	}
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return &pb.RegisterResponse{Profile: toProto(p)}, nil
}

func (s *ProfileService) GetById(ctx context.Context, req *pb.GetByIdRequest) (*pb.ProfileResponse, error) {
	p, err := s.profiles.GetById(ctx, req.Id)
	if errors.Is(err, repository.ErrNotFound) {
		return nil, status.Error(codes.NotFound, "profile not found")
	}
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return &pb.ProfileResponse{Profile: toProto(p)}, nil
}

func (s *ProfileService) GetByPhone(ctx context.Context, req *pb.GetByPhoneRequest) (*pb.ProfileResponse, error) {
	p, err := s.profiles.GetByPhone(ctx, req.Phone)
	if errors.Is(err, repository.ErrNotFound) {
		return nil, status.Error(codes.NotFound, "profile not found")
	}
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return &pb.ProfileResponse{Profile: toProto(p)}, nil
}

func (s *ProfileService) UpdateById(ctx context.Context, req *pb.UpdateByIdRequest) (*pb.ProfileResponse, error) {
	u := repository.ProfileUpdate{}
	if req.Fname != "" {
		u.Fname = &req.Fname
	}
	if req.Lname != "" {
		u.Lname = &req.Lname
	}
	if req.Email != "" {
		u.Email = &req.Email
	}
	if req.Address != "" {
		u.Address = &req.Address
	}
	p, err := s.profiles.Update(ctx, req.Id, u)
	if errors.Is(err, repository.ErrNotFound) {
		return nil, status.Error(codes.NotFound, "profile not found")
	}
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return &pb.ProfileResponse{Profile: toProto(p)}, nil
}

func (s *ProfileService) RequestOtp(ctx context.Context, req *pb.RequestOtpRequest) (*pb.RequestOtpResponse, error) {
	if req.Phone == "" {
		return nil, status.Error(codes.InvalidArgument, "phone is required")
	}

	exists, err := s.profiles.ExistsByPhone(ctx, req.Phone)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	if !exists {
		if _, err := s.profiles.Create(ctx, req.Phone, "", "", "", ""); err != nil {
			return nil, status.Error(codes.Internal, err.Error())
		}
		log.Printf("auto-registered: phone=%s", req.Phone)
	}

	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return nil, status.Error(codes.Internal, "otp generation failed")
	}
	code := fmt.Sprintf("%06d", n.Int64())
	if err := s.otps.Store(ctx, req.Phone, code, s.otpTtl); err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}

	go s.sendSms(req.Phone, code)

	return &pb.RequestOtpResponse{Sent: true}, nil
}

func (s *ProfileService) VerifyOtp(ctx context.Context, req *pb.VerifyOtpRequest) (*pb.VerifyOtpResponse, error) {
	valid, err := s.otps.Consume(ctx, req.Phone, req.Otp)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	if !valid {
		return &pb.VerifyOtpResponse{Valid: false}, nil
	}
	p, err := s.profiles.GetByPhone(ctx, req.Phone)
	if err != nil {
		return nil, status.Error(codes.Internal, err.Error())
	}
	return &pb.VerifyOtpResponse{Valid: true, ProfileId: p.ID}, nil
}

func toProto(p repository.Profile) *pb.Profile {
	return &pb.Profile{
		Id:      p.ID,
		Phone:   p.Phone,
		Fname:   p.Fname,
		Lname:   p.Lname,
		Email:   p.Email,
		Address: p.Address,
	}
}
