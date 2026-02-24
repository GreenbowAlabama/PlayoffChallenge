//
//  AppEnvironment.swift
//  PlayoffChallenge
//
//  Centralized environment configuration for the application.
//  Provides baseURL and authentication service to all services.
//

import Foundation

@MainActor
final class AppEnvironment {
    static let shared = AppEnvironment()

    let baseURL: URL
    let authService: AuthService
    let environment: String

    private init() {
        guard let baseURLValue = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              !baseURLValue.isEmpty,
              let url = URL(string: baseURLValue) else {
            fatalError("AppEnvironment: API_BASE_URL not configured in Info.plist")
        }

        self.baseURL = url
        self.authService = AuthService.shared

        // Determine environment from URL
        if baseURLValue.contains("staging") {
            self.environment = "staging"
        } else if baseURLValue.contains("production") {
            self.environment = "production"
        } else {
            self.environment = "unknown"
        }

        // Startup logging
        print("🌎 App Environment: \(self.environment)")
        print("🌎 Base URL: \(self.baseURL.absoluteString)")
    }

    // For testing with custom environment
    init(baseURL: URL, authService: AuthService) {
        self.baseURL = baseURL
        self.authService = authService

        // Determine environment from URL
        let baseURLString = baseURL.absoluteString
        if baseURLString.contains("staging") {
            self.environment = "staging"
        } else if baseURLString.contains("production") {
            self.environment = "production"
        } else {
            self.environment = "custom"
        }
    }
}
