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
    let joinBaseURL: URL
    let authService: AuthService
    let environment: String

    private init() {
        guard let baseURLValue = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String,
              !baseURLValue.isEmpty,
              let url = URL(string: baseURLValue) else {
            fatalError("AppEnvironment: API_BASE_URL not configured in Info.plist")
        }

        guard let joinURLValue = Bundle.main.object(forInfoDictionaryKey: "JOIN_BASE_URL") as? String,
              !joinURLValue.isEmpty,
              let joinUrl = URL(string: joinURLValue) else {
            fatalError("AppEnvironment: JOIN_BASE_URL not configured in Info.plist")
        }

        self.baseURL = url
        self.joinBaseURL = joinUrl
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
        print("🌎 Join Base URL: \(self.joinBaseURL.absoluteString)")
    }

    // For testing with custom environment
    init(baseURL: URL, joinBaseURL: URL? = nil, authService: AuthService) {
        self.baseURL = baseURL
        self.joinBaseURL = joinBaseURL ?? baseURL // Default to baseURL if not provided
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
