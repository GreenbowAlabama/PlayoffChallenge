// ============================================
// NEW FILE: UserPicksQuickView.swift
// ============================================

import SwiftUI
import Combine

struct UserPicksQuickView: View {
    let userId: UUID
    let userName: String
    let teamName: String
    let weekNumber: Int
    let totalPoints: Double
    
    @Environment(\.dismiss) var dismiss
    @StateObject private var viewModel = UserPicksQuickViewModel()
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                // Header with total points
                VStack(spacing: 8) {
                    Text(teamName)
                        .font(.title2)
                        .fontWeight(.bold)
                    
                    Text(userName)
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    
                    HStack(spacing: 4) {
                        Text("Week \(weekNumber)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                        Text("•")
                            .foregroundColor(.secondary)
                        Text("\(String(format: "%.1f", totalPoints)) pts")
                            .font(.title3)
                            .fontWeight(.semibold)
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(
                    LinearGradient(
                        gradient: Gradient(colors: [Color.blue.opacity(0.1), Color.purple.opacity(0.1)]),
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                
                Divider()
                
                // Player list
                if viewModel.isLoading {
                    ProgressView("Loading lineup...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if viewModel.picks.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "person.crop.circle.badge.questionmark")
                            .font(.system(size: 50))
                            .foregroundColor(.gray)
                        Text("No picks for this week")
                            .foregroundColor(.secondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else {
                    ScrollView {
                        LazyVStack(spacing: 12) {
                            ForEach(viewModel.picks) { pick in
                                PlayerPickCard(pick: pick)
                            }
                        }
                        .padding()
                    }
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
        .task {
            await viewModel.loadPicks(userId: userId, weekNumber: weekNumber)
        }
    }
}

struct PlayerPickCard: View {
    let pick: UserPickDetail
    
    var body: some View {
        HStack(spacing: 12) {
            // Position badge
            Text(pick.position)
                .font(.caption)
                .fontWeight(.bold)
                .foregroundColor(.white)
                .frame(width: 40, height: 40)
                .background(positionColor(pick.position))
                .clipShape(Circle())
            
            // Player info
            VStack(alignment: .leading, spacing: 4) {
                Text(pick.fullName)
                    .font(.body)
                    .fontWeight(.medium)
                
                HStack(spacing: 4) {
                    Text(pick.team)
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    if pick.locked {
                        Image(systemName: "lock.fill")
                            .font(.caption2)
                            .foregroundColor(.orange)
                    }
                }
            }
            
            Spacer()
            
            // Points
            VStack(alignment: .trailing, spacing: 2) {
                if pick.points > 0 {
                    Text(String(format: "%.1f", pick.points))
                        .font(.title3)
                        .fontWeight(.bold)
                        .foregroundColor(.primary)
                    
                    if let multiplier = pick.multiplier, multiplier > 1.0 {
                        HStack(spacing: 2) {
                            Text(String(format: "%.1f", pick.basePoints))
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text("×")
                                .font(.caption2)
                                .foregroundColor(.secondary)
                            Text(String(format: "%.1f", multiplier))
                                .font(.caption2)
                                .foregroundColor(.orange)
                        }
                    }
                } else {
                    Text("-")
                        .font(.title3)
                        .foregroundColor(.gray)
                    
                    Text("No score")
                        .font(.caption2)
                        .foregroundColor(.gray)
                }
            }
        }
        .padding()
        .background(Color(.systemGray6))
        .cornerRadius(12)
    }
    
    private func positionColor(_ position: String) -> Color {
        switch position {
        case "QB": return .blue
        case "RB": return .green
        case "WR": return .orange
        case "TE": return .purple
        case "K": return .red
        case "DEF": return .indigo
        default: return .gray
        }
    }
}

@MainActor
class UserPicksQuickViewModel: ObservableObject {
    @Published var picks: [UserPickDetail] = []
    @Published var isLoading = false
    
    func loadPicks(userId: UUID, weekNumber: Int) async {
        isLoading = true
        
        do {
            picks = try await APIService.shared.getUserPickDetails(
                userId: userId,
                weekNumber: weekNumber
            )
        } catch {
            print("Failed to load user picks: \(error)")
        }
        
        isLoading = false
    }
}

#Preview {
    UserPicksQuickView(
        userId: UUID(),
        userName: "John Doe",
        teamName: "Team Thunder",
        weekNumber: 11,
        totalPoints: 125.5
    )
}
