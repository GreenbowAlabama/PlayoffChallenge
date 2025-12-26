Architecture → Worker Handoff

TestFlight Payment Layer Visibility Fix

Objective

Disable all payment related UI and StoreKit execution in TestFlight builds on real devices using a deterministic, compile time approach.

This is an iOS client only change.

⸻

Ground Truth

These are not hypotheses. Treat them as facts.

• Backend already allows access without an active entitlement
• Backend must not be modified
• Simulator behaves correctly
• Real devices running TestFlight do not
• This is caused by iOS environment detection or build configuration
• Receipt state must not be used
• Runtime heuristics must not be used

⸻

Success Criteria

In TestFlight builds on real devices:

• No payment UI
• No paywalls
• No subscription screens
• No StoreKit initialization
• No StoreKit prompts

In App Store builds:

• Payment UI works normally

⸻

Scope Lock

You may modify

• iOS client code only
• Xcode build settings
• Payment related UI and initialization paths

You may NOT modify

• Backend code
• APIs
• Subscription enforcement logic server side
• Business logic unrelated to payments

⸻

Required Implementation

1. Compile Time Flag

Add a compile time flag for TestFlight.

Xcode path:
Target → Build Settings → Other Swift Flags → Release

Add:
-DTESTFLIGHT

Rules:
• Only in Release
• Not in Debug
• Clean build after adding

⸻

2. Single Source of Truth

Create exactly one environment check.

enum AppEnvironment {
    static let isTestFlight: Bool = {
        #if TESTFLIGHT
        return true
        #else
        return false
        #endif
    }()
}

Rules:
• Defined once
• Globally accessible
• No duplicate helpers
• No inline #if TESTFLIGHT checks elsewhere

⸻

3. Payment Gating Rule

All payment related code must be gated behind:

guard !AppEnvironment.isTestFlight else { return }

This includes:
• StoreKit setup
• Paywall presentation
• Subscription UI
• Purchase flows
• Navigation paths that lead to payment UI

⸻

Files You Are Allowed to Read

To avoid massive token reads, restrict inspection to only these categories.

Search targets only:
• Files importing StoreKit
• Files containing payment or subscription view controllers
• App launch code where StoreKit is initialized
• Paywall presentation logic

Do NOT read:
• Networking layers
• Backend API clients
• Models unrelated to subscriptions
• Feature flags unrelated to payments

If unsure whether a file is relevant, do not open it.

⸻

Known Failure Modes to Check

You are validating exactly one of these.
	1.	TESTFLIGHT flag missing from Release
	2.	Environment check occurs after payment UI is created
	3.	Multiple payment entry points and only some are gated

Do not invent new theories.

⸻

Validation Steps

Run these in order.
	1.	Confirm -DTESTFLIGHT exists in Release only
	2.	Clean build folder
	3.	Archive using Release configuration
	4.	Upload to TestFlight
	5.	Install on physical device
	6.	Launch app
	7.	Navigate entire app
	8.	Confirm zero payment UI
	9.	Confirm zero StoreKit logs

Optional:
• Remove flag and confirm App Store behavior works

⸻

Completion Report Requirements

When done, report only:

• Files modified
• Where AppEnvironment.isTestFlight is defined
• Where payment code paths are gated
• Confirmation TestFlight device shows no payment UI

No extra commentary.

⸻

Definition of Done

All must be true.

• Compile flag present
• Central environment check exists
• All payment code paths gated
• TestFlight build on real device shows zero payment UI
• No StoreKit calls occur

⸻

Final Constraint

Do not refactor.
Do not optimize.
Do not clean unrelated code.

Solve only the payment visibility problem.