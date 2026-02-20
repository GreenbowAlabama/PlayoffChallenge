# Privacy & Compliance SDK Audit

**App Name:** PlayoffChallenge
**Bundle ID:** com.iancarter.PlayoffChallenge
**Audit Date:** 2025-12-22
**Purpose:** App Store Review - Privacy & Data Use Disclosure

---

## Executive Summary

This app uses minimal third-party SDKs. No analytics, crash reporting, advertising, or tracking SDKs are present. Data collection is limited to authentication and core app functionality.

---

## iOS App SDKs

### 1. Sign in with Apple (Apple AuthenticationServices)
- **Platform:** iOS
- **Type:** First-party authentication
- **Data touched:** Apple ID, email address (optional), full name (optional)
- **Purpose:** User authentication
- **Data retention:** Stored in backend database for account management

---

## Backend Dependencies

### 1. geoip-lite
- **Platform:** Backend (Node.js)
- **Type:** IP geolocation library
- **Data touched:** IP address (temporary, not stored)
- **Purpose:** State compliance validation for legal restrictions
- **Implementation:** `backend/server.js:2798-2823`
- **Data retention:** Not stored; used only for real-time geolocation lookup

### 2. express-rate-limit
- **Platform:** Backend (Node.js)
- **Type:** Rate limiting middleware
- **Data touched:** IP address (temporary)
- **Purpose:** API abuse prevention
- **Data retention:** Temporary in-memory cache, cleared after time window

---

## Third-Party SDKs NOT Present

The following SDK categories are **NOT** used in this application:

- Analytics (Firebase Analytics, Amplitude, Mixpanel, Segment)
- Crash/error reporting (Firebase Crashlytics, Sentry)
- Advertising/attribution (Meta Pixel, Google Ads, AppsFlyer, Adjust, Branch)
- User tracking or session replay (Hotjar, FullStory, LogRocket)
- Device fingerprinting
- Social media SDKs (Facebook SDK, Twitter SDK)
- Push notification services (OneSignal, Pusher)

---

## IDFA & App Tracking Transparency

**IDFA Access:** No

**App Tracking Transparency (ATT) Prompt:** No

**AdSupport Framework:** Not imported

**AppTrackingTransparency Framework:** Not imported

**NSUserTrackingUsageDescription:** Not present in Info.plist

---

## User Data Collection

### Data Collected by the App

| Data Type | Source | Purpose | Storage Location | Retention |
|-----------|--------|---------|------------------|-----------|
| Apple ID | Sign in with Apple | Authentication | Backend database | Account lifetime |
| Email | Sign in with Apple (optional) | Account recovery | Backend database | Account lifetime |
| Full Name | Sign in with Apple (optional) | User profile | Backend database | Account lifetime |
| Username | User input | Display name | Backend database | Account lifetime |
| IP Address | Network request | State compliance check | Not stored | Not retained |
| Game Picks | User input | App functionality | Backend database | Account lifetime |
| Payment Status | Admin input | App functionality | Backend database | Account lifetime |
| State (US) | User input | Legal compliance | Backend database | Account lifetime |

### Data NOT Collected

- Device identifiers (IDFA, IDFV not accessed)
- Location data (no CoreLocation usage)
- Precise geolocation
- Contacts
- Photos/Camera
- Microphone
- Health data
- Browsing history
- Search history
- Purchase history (outside this app)
- Financial information
- Government IDs

---

## Privacy Manifest Status

**PrivacyInfo.xcprivacy:** Not present (app does not use required reason APIs)

The app does not use any APIs requiring privacy manifests under Apple's current requirements (UserDefaults is used only for storing user session ID locally).

---

## Data Sharing & Third Parties

**Data shared with third parties:** None

**Data sold to third parties:** None

**User tracking across apps/websites:** None

---

## App Store Privacy Nutrition Label

### Recommended Disclosures

**Data Used to Track You:** None

**Data Linked to You:**
- Contact Info: Email Address (optional)
- Identifiers: User ID (Apple ID)

**Data Not Linked to You:** None

---

## Technical Implementation Details

### iOS App
- **Main entry point:** `ios-app/PlayoffChallenge/PlayoffChallengeApp.swift`
- **Authentication:** `ios-app/PlayoffChallenge/Services/AuthService.swift`
- **API client:** `ios-app/PlayoffChallenge/Services/APIService.swift`
- **Local storage:** UserDefaults (userId only)
- **No third-party SDKs:** Verified via `project.pbxproj` (lines 105-106, no package dependencies)

### Backend
- **Server:** `backend/server.js`
- **Dependencies:** `backend/package.json`
- **IP geolocation:** Lines 6, 2798-2823 in server.js
- **Rate limiting:** Lines 8, 20-36 in server.js

---

## Compliance Certifications

- COPPA: App not directed at children under 13
- GDPR: Data minimization principles applied
- CCPA: No data sale; minimal collection
- State gambling restrictions: IP-based state validation implemented

---

## Contact

For privacy inquiries or data deletion requests, contact the app developer through App Store Connect.

---

**Document Version:** 1.0
**Last Updated:** 2025-12-22
