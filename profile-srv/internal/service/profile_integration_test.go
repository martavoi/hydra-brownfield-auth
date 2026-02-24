package service_test

import (
	"context"
	"net"
	"sync"
	"testing"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"

	"github.com/hydra-auth/profile-srv/internal/repository/sqlite"
	"github.com/hydra-auth/profile-srv/internal/service"
	pb "github.com/hydra-auth/profile-srv/proto/profile"
)

// captured records the last OTP delivery made by the SMS sender stub.
type captured struct {
	mu    sync.Mutex
	phone string
	code  string
	ch    chan struct{}
}

func newCaptured() *captured {
	return &captured{ch: make(chan struct{}, 1)}
}

func (c *captured) sender() func(string, string) {
	return func(phone, code string) {
		c.mu.Lock()
		c.phone, c.code = phone, code
		c.mu.Unlock()
		select {
		case c.ch <- struct{}{}:
		default:
		}
	}
}

// wait blocks until the sender is called (or the test times out).
func (c *captured) wait(t *testing.T) (phone, code string) {
	t.Helper()
	select {
	case <-c.ch:
	case <-time.After(2 * time.Second):
		t.Fatal("OTP sender not called within 2s")
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.phone, c.code
}

// newTestClient wires up an in-process gRPC server backed by an in-memory
// SQLite store and returns a client + the OTP capture helper.
func newTestClient(t *testing.T) (pb.ProfileServiceClient, *captured) {
	t.Helper()

	cap := newCaptured()

	store, err := sqlite.Open(":memory:")
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { store.Close() })

	svc := service.NewProfileService(store.Profiles(), store.Otps(), cap.sender(), 300)

	lis := bufconn.Listen(1 << 20)
	srv := grpc.NewServer()
	pb.RegisterProfileServiceServer(srv, svc)
	go srv.Serve(lis) //nolint:errcheck
	t.Cleanup(func() { srv.Stop() })

	conn, err := grpc.NewClient(
		"passthrough:///bufnet",
		grpc.WithContextDialer(func(ctx context.Context, _ string) (net.Conn, error) {
			return lis.DialContext(ctx)
		}),
		grpc.WithTransportCredentials(insecure.NewCredentials()),
	)
	if err != nil {
		t.Fatalf("dial bufconn: %v", err)
	}
	t.Cleanup(func() { conn.Close() })

	return pb.NewProfileServiceClient(conn), cap
}

// codeOf returns the gRPC status code from an error, or codes.OK if err==nil.
func codeOf(err error) codes.Code {
	return status.Code(err)
}

// ── Tests ────────────────────────────────────────────────────────────────────

func TestRegister(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	resp, err := client.Register(ctx, &pb.RegisterRequest{
		Phone: "+12125550001",
		Fname: "Jane",
		Lname: "Doe",
		Email: "jane@example.com",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	p := resp.Profile
	if p.Id == "" {
		t.Error("expected non-empty ID")
	}
	if p.Phone != "+12125550001" {
		t.Errorf("phone: got %q, want %q", p.Phone, "+12125550001")
	}
	if p.Fname != "Jane" {
		t.Errorf("fname: got %q, want %q", p.Fname, "Jane")
	}
	if p.Lname != "Doe" {
		t.Errorf("lname: got %q, want %q", p.Lname, "Doe")
	}
}

func TestRegister_Duplicate(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	req := &pb.RegisterRequest{Phone: "+12125550002"}
	if _, err := client.Register(ctx, req); err != nil {
		t.Fatalf("first Register: %v", err)
	}

	_, err := client.Register(ctx, req)
	if codeOf(err) != codes.AlreadyExists {
		t.Fatalf("expected AlreadyExists, got: %v", err)
	}
}

func TestGetById(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	reg, err := client.Register(ctx, &pb.RegisterRequest{Phone: "+12125550003", Fname: "Test"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	id := reg.Profile.Id

	resp, err := client.GetById(ctx, &pb.GetByIdRequest{Id: id})
	if err != nil {
		t.Fatalf("GetByID: %v", err)
	}
	if resp.Profile.Id != id {
		t.Errorf("id: got %q, want %q", resp.Profile.Id, id)
	}
	if resp.Profile.Fname != "Test" {
		t.Errorf("fname: got %q, want %q", resp.Profile.Fname, "Test")
	}
}

func TestGetByPhone(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	phone := "+12125550004"
	reg, err := client.Register(ctx, &pb.RegisterRequest{Phone: phone, Lname: "Bar"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	resp, err := client.GetByPhone(ctx, &pb.GetByPhoneRequest{Phone: phone})
	if err != nil {
		t.Fatalf("GetByPhone: %v", err)
	}
	if resp.Profile.Id != reg.Profile.Id {
		t.Errorf("id mismatch: got %q, want %q", resp.Profile.Id, reg.Profile.Id)
	}
	if resp.Profile.Lname != "Bar" {
		t.Errorf("lname: got %q, want %q", resp.Profile.Lname, "Bar")
	}
}

func TestGetById_NotFound(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	_, err := client.GetById(ctx, &pb.GetByIdRequest{Id: "doesnotexist"})
	if codeOf(err) != codes.NotFound {
		t.Fatalf("expected NotFound, got: %v", err)
	}
}

func TestUpdateById(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	reg, err := client.Register(ctx, &pb.RegisterRequest{
		Phone: "+12125550005",
		Fname: "Old",
		Lname: "Name",
	})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	id := reg.Profile.Id

	// Only update fname; lname should remain "Name".
	resp, err := client.UpdateById(ctx, &pb.UpdateByIdRequest{Id: id, Fname: "New"})
	if err != nil {
		t.Fatalf("UpdateByID: %v", err)
	}
	if resp.Profile.Fname != "New" {
		t.Errorf("fname: got %q, want %q", resp.Profile.Fname, "New")
	}
	if resp.Profile.Lname != "Name" {
		t.Errorf("lname changed unexpectedly: got %q, want %q", resp.Profile.Lname, "Name")
	}
}

func TestUpdateById_NotFound(t *testing.T) {
	client, _ := newTestClient(t)
	ctx := context.Background()

	_, err := client.UpdateById(ctx, &pb.UpdateByIdRequest{Id: "ghost", Fname: "X"})
	if codeOf(err) != codes.NotFound {
		t.Fatalf("expected NotFound, got: %v", err)
	}
}

func TestRequestOtp(t *testing.T) {
	client, cap := newTestClient(t)
	ctx := context.Background()

	// Register so phone is known.
	if _, err := client.Register(ctx, &pb.RegisterRequest{Phone: "+12125550006"}); err != nil {
		t.Fatalf("Register: %v", err)
	}

	resp, err := client.RequestOtp(ctx, &pb.RequestOtpRequest{Phone: "+12125550006"})
	if err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	if !resp.Sent {
		t.Error("expected Sent=true")
	}

	_, code := cap.wait(t)
	if len(code) != 6 {
		t.Errorf("expected 6-digit OTP, got %q", code)
	}
}

func TestRequestOtp_AutoRegisters(t *testing.T) {
	client, cap := newTestClient(t)
	ctx := context.Background()

	// Phone not previously registered.
	phone := "+12125550007"
	resp, err := client.RequestOtp(ctx, &pb.RequestOtpRequest{Phone: phone})
	if err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	if !resp.Sent {
		t.Error("expected Sent=true")
	}
	cap.wait(t) // ensure sender was called

	// Profile should now exist.
	if _, err := client.GetByPhone(ctx, &pb.GetByPhoneRequest{Phone: phone}); err != nil {
		t.Fatalf("GetByPhone after auto-register: %v", err)
	}
}

func TestVerifyOtp_Valid(t *testing.T) {
	client, cap := newTestClient(t)
	ctx := context.Background()

	phone := "+12125550008"
	reg, err := client.Register(ctx, &pb.RegisterRequest{Phone: phone})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}

	if _, err := client.RequestOtp(ctx, &pb.RequestOtpRequest{Phone: phone}); err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	_, code := cap.wait(t)

	vResp, err := client.VerifyOtp(ctx, &pb.VerifyOtpRequest{Phone: phone, Otp: code})
	if err != nil {
		t.Fatalf("VerifyOTP: %v", err)
	}
	if !vResp.Valid {
		t.Error("expected Valid=true")
	}
	if vResp.ProfileId != reg.Profile.Id {
		t.Errorf("profile_id: got %q, want %q", vResp.ProfileId, reg.Profile.Id)
	}
}

func TestVerifyOtp_WrongCode(t *testing.T) {
	client, cap := newTestClient(t)
	ctx := context.Background()

	phone := "+12125550009"
	if _, err := client.Register(ctx, &pb.RegisterRequest{Phone: phone}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if _, err := client.RequestOtp(ctx, &pb.RequestOtpRequest{Phone: phone}); err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	cap.wait(t)

	resp, err := client.VerifyOtp(ctx, &pb.VerifyOtpRequest{Phone: phone, Otp: "000000"})
	if err != nil {
		t.Fatalf("VerifyOTP returned unexpected error: %v", err)
	}
	if resp.Valid {
		t.Error("expected Valid=false for wrong code")
	}
}

func TestVerifyOtp_UsedCode(t *testing.T) {
	client, cap := newTestClient(t)
	ctx := context.Background()

	phone := "+12125550010"
	if _, err := client.Register(ctx, &pb.RegisterRequest{Phone: phone}); err != nil {
		t.Fatalf("Register: %v", err)
	}
	if _, err := client.RequestOtp(ctx, &pb.RequestOtpRequest{Phone: phone}); err != nil {
		t.Fatalf("RequestOTP: %v", err)
	}
	_, code := cap.wait(t)

	// First verify: valid.
	first, err := client.VerifyOtp(ctx, &pb.VerifyOtpRequest{Phone: phone, Otp: code})
	if err != nil {
		t.Fatalf("first VerifyOTP: %v", err)
	}
	if !first.Valid {
		t.Fatal("expected first VerifyOTP to be Valid=true")
	}

	// Second verify with same code: must be invalid.
	second, err := client.VerifyOtp(ctx, &pb.VerifyOtpRequest{Phone: phone, Otp: code})
	if err != nil {
		t.Fatalf("second VerifyOTP returned unexpected error: %v", err)
	}
	if second.Valid {
		t.Error("expected second VerifyOTP to be Valid=false (code already used)")
	}
}
