//
//  LiveContestsView.swift
//  PlayoffChallenge
//
//  Live Contests tab showing contests currently in progress.
//  Fetches from /api/contests/live endpoint.
//

import SwiftUI
import Core

struct LiveContestsView: View {
    @EnvironmentObject var authService: AuthService
    @State private var contests: [Contest] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            ZStack {
                if isLoading {
                    ProgressView()
                        .scaleEffect(1.5)
                } else if let errorMessage, !errorMessage.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.system(size: 48))
                            .foregroundColor(.red)
                        Text("Unable to load contests")
                            .font(.headline)
                        Text(errorMessage)
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Button(action: { Task { await loadLiveContests() } }) {
                            Text("Try Again")
                                .font(.callout)
                                .padding(.horizontal, 16)
                                .padding(.vertical, 8)
                                .background(Color.blue)
                                .foregroundColor(.white)
                                .cornerRadius(6)
                        }
                    }
                    .padding()
                } else if contests.isEmpty {
                    VStack(spacing: 16) {
                        Image(systemName: "flame.fill")
                            .font(.system(size: 48))
                            .foregroundColor(.orange)
                        Text("No Live Contests")
                            .font(.headline)
                        Text("Check back soon for contests in progress")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .padding()
                } else {
                    List {
                        Section {
                            ForEach(contests, id: \.id) { contest in
                                NavigationLink(value: contest.id) {
                                    ContestListItemView(contest: contest)
                                }
                            }
                        }
                    }
                    .listStyle(.plain)
                }
            }
            .navigationTitle("LIVE Contests")
            .navigationDestination(for: UUID.self) { contestId in
                ContestDetailView(contestId: contestId)
            }
        }
        .onAppear {
            Task {
                await loadLiveContests()
            }
        }
        .refreshable {
            await loadLiveContests()
        }
    }

    private func loadLiveContests() async {
        isLoading = true
        errorMessage = nil

        do {
            guard let userId = authService.currentUser?.id else {
                throw NSError(domain: "LiveContestsView", code: -1, userInfo: [NSLocalizedDescriptionKey: "Not authenticated"])
            }

            let environment = AppEnvironment.shared
            let url = environment.baseURL.appendingPathComponent("api/contests/live")

            var request = URLRequest(url: url)
            request.httpMethod = "GET"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Bearer \(userId.uuidString)", forHTTPHeaderField: "Authorization")

            let (data, response) = try await URLSession.shared.data(for: request)

            guard let httpResponse = response as? HTTPURLResponse else {
                throw NSError(domain: "LiveContestsView", code: -1, userInfo: [NSLocalizedDescriptionKey: "Invalid response"])
            }

            switch httpResponse.statusCode {
            case 200:
                let decoder = JSONDecoder.iso8601Decoder
                let dtos = try decoder.decode([ContestListItemDTO].self, from: data)
                self.contests = dtos.map { $0.toDomain() }
                self.isLoading = false
            case 401:
                throw NSError(domain: "LiveContestsView", code: 401, userInfo: [NSLocalizedDescriptionKey: "Authentication required"])
            default:
                throw NSError(domain: "LiveContestsView", code: httpResponse.statusCode, userInfo: [NSLocalizedDescriptionKey: "Failed to fetch contests (status: \(httpResponse.statusCode))"])
            }
        } catch {
            self.errorMessage = error.localizedDescription
            self.isLoading = false
        }
    }
}

// MARK: - Preview

#Preview {
    LiveContestsView()
        .environmentObject(AuthService())
}
