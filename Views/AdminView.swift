//
//  AdminView.swift
//  PlayoffChallenge
//
//  Simplified - Essential Features Only
//

import SwiftUI
import Combine

struct AdminView: View {
    @EnvironmentObject var authService: AuthService
    @StateObject private var viewModel = AdminViewModel()
    @State private var selectedTab = 0
    
    var body: some View {
        NavigationView {
            VStack(spacing: 0) {
                Picker("", selection: $selectedTab) {
                    Text("Users").tag(0)
                    Text("Settings").tag(1)
                    Text("Set Week").tag(2)
                }
                .pickerStyle(.segmented)
                .padding()
                
                TabView(selection: $selectedTab) {
                    UsersTab(viewModel: viewModel)
                        .tag(0)
                    
                    SettingsTab(viewModel: viewModel)
                        .tag(1)
                    
                    SetWeekTab(viewModel: viewModel)
                        .tag(2)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
            }
            .navigationTitle("Admin Panel")
            .task {
                if let userId = authService.currentUser?.id {
                    await viewModel.loadAllData(userId: userId)
                }
            }
        }
    }
}

// MARK: - Users Tab
struct UsersTab: View {
    @ObservedObject var viewModel: AdminViewModel

    var body: some View {
        List {
            if viewModel.isLoading {
                ProgressView()
            } else {
                // Header row
                HStack {
                    Text("User")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.secondary)
                        .frame(width: 100, alignment: .leading)

                    Text("Contact")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text("Paid")
                        .font(.caption)
                        .fontWeight(.bold)
                        .foregroundColor(.secondary)
                        .frame(width: 50, alignment: .center)
                }
                .padding(.vertical, 4)
                .listRowBackground(Color(.systemGray6))

                ForEach(viewModel.users) { user in
                    UserRow(user: user, viewModel: viewModel)
                }
            }
        }
        .refreshable {
            await viewModel.loadUsers()
        }
    }
}

struct UserRow: View {
    let user: User
    @ObservedObject var viewModel: AdminViewModel
    @State private var showCopiedEmail = false
    @State private var showCopiedPhone = false

    var body: some View {
        HStack(spacing: 12) {
            // Username
            VStack(alignment: .leading, spacing: 2) {
                Text(user.username ?? "Unknown")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .lineLimit(1)
            }
            .frame(width: 100, alignment: .leading)

            // Contact info (Email + Phone)
            VStack(alignment: .leading, spacing: 4) {
                if let email = user.email, !email.isEmpty {
                    Button(action: {
                        UIPasteboard.general.string = email
                        showCopiedEmail = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            showCopiedEmail = false
                        }
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "envelope.fill")
                                .font(.caption2)
                                .foregroundColor(.blue)
                            Text(email)
                                .font(.caption)
                                .foregroundColor(.primary)
                                .lineLimit(1)
                            if showCopiedEmail {
                                Image(systemName: "checkmark")
                                    .font(.caption2)
                                    .foregroundColor(.green)
                            }
                        }
                    }
                } else {
                    HStack(spacing: 4) {
                        Image(systemName: "envelope")
                            .font(.caption2)
                            .foregroundColor(.gray)
                        Text("No email")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }

                if let phone = user.phone, !phone.isEmpty {
                    Button(action: {
                        UIPasteboard.general.string = phone
                        showCopiedPhone = true
                        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                            showCopiedPhone = false
                        }
                    }) {
                        HStack(spacing: 4) {
                            Image(systemName: "phone.fill")
                                .font(.caption2)
                                .foregroundColor(.blue)
                            Text(phone)
                                .font(.caption)
                                .foregroundColor(.primary)
                                .lineLimit(1)
                            if showCopiedPhone {
                                Image(systemName: "checkmark")
                                    .font(.caption2)
                                    .foregroundColor(.green)
                            }
                        }
                    }
                } else {
                    HStack(spacing: 4) {
                        Image(systemName: "phone")
                            .font(.caption2)
                            .foregroundColor(.gray)
                        Text("No phone")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Spacer()

            // Payment toggle
            Toggle("", isOn: binding(for: user))
                .labelsHidden()
                .frame(width: 50)
        }
        .padding(.vertical, 4)
    }

    private func binding(for: User) -> Binding<Bool> {
        Binding(
            get: { user.paid },
            set: { newValue in
                Task {
                    await viewModel.updatePaymentStatus(userId: user.id, hasPaid: newValue)
                }
            }
        )
    }
}

// MARK: - Settings Tab
struct SettingsTab: View {
    @ObservedObject var viewModel: AdminViewModel
    @State private var showingSaveSuccess = false
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Payment Settings")
                        .font(.headline)
                    
                    HStack {
                        Text("Entry Amount")
                        Spacer()
                        TextField("Amount", value: $viewModel.entryAmount, format: .number)
                            .keyboardType(.decimalPad)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                            .frame(width: 100)
                    }
                    
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Payment Handles")
                            .font(.subheadline)
                        
                        TextField("Venmo Handle", text: $viewModel.venmoHandle)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                        
                        TextField("CashApp Handle", text: $viewModel.cashappHandle)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                        
                        TextField("Zelle Handle", text: $viewModel.zelleHandle)
                            .textFieldStyle(RoundedBorderTextFieldStyle())
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
                
                VStack(alignment: .leading, spacing: 12) {
                    Text("Position Limits")
                        .font(.headline)
                    
                    PositionLimitRow(label: "QB", value: $viewModel.qbLimit)
                    PositionLimitRow(label: "RB", value: $viewModel.rbLimit)
                    PositionLimitRow(label: "WR", value: $viewModel.wrLimit)
                    PositionLimitRow(label: "TE", value: $viewModel.teLimit)
                    PositionLimitRow(label: "K", value: $viewModel.kLimit)
                    PositionLimitRow(label: "DEF", value: $viewModel.defLimit)
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
                
                Button(action: {
                    Task {
                        await viewModel.saveSettings()
                        showingSaveSuccess = true
                    }
                }) {
                    Text("Save Settings")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .cornerRadius(12)
                }
                Button(action: {
                    Task {
                        await viewModel.syncESPNIds()
                        showingSaveSuccess = true
                    }
                }) {
                    Text("Sync ESPN IDs")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.purple)
                        .cornerRadius(12)
                }
            }
            .padding()
        }
        .alert("Settings Saved", isPresented: $showingSaveSuccess) {
            Button("OK", role: .cancel) { }
        }
    }
}

struct PositionLimitRow: View {
    let label: String
    @Binding var value: Int
    
    var body: some View {
        HStack {
            Text(label)
                .frame(width: 50, alignment: .leading)
            
            Stepper("\(value)", value: $value, in: 0...10)
        }
    }
}

// MARK: - Set Week Tab (Enhanced with Lock Controls)
struct SetWeekTab: View {
    @ObservedObject var viewModel: AdminViewModel
    @State private var showSuccess = false
    @State private var successMessage = ""
    @State private var isLoading = false
    
    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Current Week Status
                VStack(spacing: 12) {
                    Text("Current Week Status")
                        .font(.headline)
                        .foregroundColor(.secondary)
                    
                    HStack(spacing: 20) {
                        VStack {
                            Text("Week")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Text("\(viewModel.currentActiveWeek)")
                                .font(.system(size: 48, weight: .bold))
                                .foregroundColor(.blue)
                        }
                        
                        VStack {
                            Text("Status")
                                .font(.caption)
                                .foregroundColor(.secondary)
                            Image(systemName: viewModel.isWeekActive ? "lock.open.fill" : "lock.fill")
                                .font(.system(size: 36))
                                .foregroundColor(viewModel.isWeekActive ? .green : .orange)
                            Text(viewModel.isWeekActive ? "Unlocked" : "Locked")
                                .font(.caption)
                                .fontWeight(.bold)
                                .foregroundColor(viewModel.isWeekActive ? .green : .orange)
                        }
                    }
                }
                .padding()
                .frame(maxWidth: .infinity)
                .background(Color(.systemGray6))
                .cornerRadius(12)
                
                // Lock/Unlock Controls
                VStack(spacing: 12) {
                    Text("Week Lock Controls")
                        .font(.headline)
                    
                    Button(action: {
                        Task {
                            isLoading = true
                            await viewModel.toggleWeekLock()
                            successMessage = viewModel.isWeekActive ? "Week unlocked" : "Week locked"
                            showSuccess = true
                            isLoading = false
                        }
                    }) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Image(systemName: viewModel.isWeekActive ? "lock" : "lock.open")
                            Text(viewModel.isWeekActive ? "Lock Week \(viewModel.currentActiveWeek)" : "Unlock Week \(viewModel.currentActiveWeek)")
                                .font(.headline)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(viewModel.isWeekActive ? Color.orange : Color.green)
                        .cornerRadius(12)
                    }
                    .disabled(isLoading)
                    
                    Text(viewModel.isWeekActive ? "Players can currently edit lineups" : "Players cannot edit lineups")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)
                
                Divider()
                    .padding(.vertical, 8)
                
                // Change Week
                VStack(spacing: 12) {
                    Text("Set Active Week")
                        .font(.title2)
                        .fontWeight(.bold)
                    
                    Text("Choose which week to activate")
                        .font(.subheadline)
                        .foregroundColor(.secondary)
                    
                    Picker("Week", selection: $viewModel.selectedWeek) {
                        Text("Week 12 - Wild Card").tag(12)
                        Text("Week 13 - Divisional").tag(13)
                        Text("Week 14 - Conference").tag(14)
                        Text("Week 15 - Super Bowl").tag(15)
                    }
                    .pickerStyle(.wheel)
                    .frame(height: 150)
                    
                    Text("Or enter NFL week number for testing:")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    
                    TextField("Week Number", value: $viewModel.selectedWeek, format: .number)
                        .keyboardType(.numberPad)
                        .textFieldStyle(RoundedBorderTextFieldStyle())
                        .frame(width: 100)
                    
                    Button(action: {
                        Task {
                            isLoading = true
                            await viewModel.setActiveWeekAndUnlock(weekNumber: viewModel.selectedWeek)
                            successMessage = "Week \(viewModel.selectedWeek) is now active and unlocked"
                            showSuccess = true
                            isLoading = false
                        }
                    }) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            }
                            Text(isLoading ? "Setting..." : "Set Week \(viewModel.selectedWeek) as Current")
                                .font(.headline)
                        }
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.blue)
                        .cornerRadius(12)
                    }
                    .disabled(isLoading || viewModel.selectedWeek == viewModel.currentActiveWeek)
                    
                    if viewModel.selectedWeek == viewModel.currentActiveWeek {
                        Text("Already on Week \(viewModel.currentActiveWeek)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                }
                .padding()
                .background(Color(.systemGray6))
                .cornerRadius(12)

                // Quick Action (always visible for testing)
                VStack(spacing: 12) {
                    Text("Quick Action")
                        .font(.headline)
                        
                        Button(action: {
                            Task {
                                isLoading = true
                                await viewModel.lockAndAdvanceWeek()
                                successMessage = "Locked Week \(viewModel.currentActiveWeek - 1) and advanced to Week \(viewModel.currentActiveWeek)"
                                showSuccess = true
                                isLoading = false
                            }
                        }) {
                            HStack {
                                if isLoading {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                }
                                Image(systemName: "forward.fill")
                                Text("Lock & Advance to Next Week")
                                    .font(.headline)
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.purple)
                            .cornerRadius(12)
                        }
                        .disabled(isLoading)

                        Text("Locks current week and moves to Week \(viewModel.currentActiveWeek + 1)")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        Divider()
                            .padding(.vertical, 8)

                        // Process Week Transition for Multipliers
                        Button(action: {
                            Task {
                                isLoading = true
                                await viewModel.processWeekTransition()
                                successMessage = viewModel.transitionMessage ?? "Week transition processed"
                                showSuccess = true
                                isLoading = false
                            }
                        }) {
                            HStack {
                                if isLoading {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                }
                                Image(systemName: "arrow.triangle.2.circlepath")
                                Text("Process Week Transition (Multipliers)")
                                    .font(.headline)
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .padding()
                            .background(Color.orange)
                            .cornerRadius(12)
                        }
                        .disabled(isLoading)

                        Text("Updates multipliers for advancing players from Week \(viewModel.currentActiveWeek) to Week \(viewModel.currentActiveWeek + 1)")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .padding()
                    .background(Color(.systemGray6))
                    .cornerRadius(12)
            }
            .padding()
        }
        .alert("Success", isPresented: $showSuccess) {
            Button("OK", role: .cancel) { }
        } message: {
            Text(successMessage)
        }
    }
}

// MARK: - Admin View Model
@MainActor
class AdminViewModel: ObservableObject {
    @Published var users: [User] = []
    @Published var entryAmount: Double = 0
    @Published var venmoHandle: String = ""
    @Published var cashappHandle: String = ""
    @Published var zelleHandle: String = ""
    @Published var qbLimit: Int = 1
    @Published var rbLimit: Int = 2
    @Published var wrLimit: Int = 3
    @Published var teLimit: Int = 1
    @Published var kLimit: Int = 1
    @Published var defLimit: Int = 1
    @Published var currentActiveWeek: Int = 12
    @Published var selectedWeek: Int = 12
    @Published var isWeekActive: Bool = true
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var transitionMessage: String?

    private var currentUserId: UUID? = nil
    
    func loadAllData(userId: UUID) async {
        currentUserId = userId
        isLoading = true
        errorMessage = nil
        
        do {
            self.users = try await APIService.shared.getAllUsers(adminUserId: userId)
        } catch {
            print("Failed to load users: \(error)")
        }
        
        do {
            let settingsResult = try await APIService.shared.getSettings()
            self.entryAmount = settingsResult.entryAmount
            self.venmoHandle = settingsResult.venmoHandle ?? ""
            self.cashappHandle = settingsResult.cashappHandle ?? ""
            self.zelleHandle = settingsResult.zelleHandle ?? ""
            self.qbLimit = settingsResult.qbLimit ?? 1
            self.rbLimit = settingsResult.rbLimit ?? 2
            self.wrLimit = settingsResult.wrLimit ?? 3
            self.teLimit = settingsResult.teLimit ?? 1
            self.kLimit = settingsResult.kLimit ?? 1
            self.defLimit = settingsResult.defLimit ?? 1
            self.currentActiveWeek = settingsResult.currentPlayoffWeek
            self.selectedWeek = settingsResult.currentPlayoffWeek
            self.isWeekActive = settingsResult.isWeekActive ?? true
        } catch {
            print("Failed to load settings: \(error)")
        }
        
        isLoading = false
    }
    
    func loadUsers() async {
        guard let userId = currentUserId else { return }
        do {
            users = try await APIService.shared.getAllUsers(adminUserId: userId)
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    func syncESPNIds() async {
        do {
            try await APIService.shared.syncESPNIds()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    func updatePaymentStatus(userId: UUID, hasPaid: Bool) async {
        guard let adminId = currentUserId else { return }
        do {
            let updatedUser = try await APIService.shared.updateUserPaymentStatus(
                userId: userId,
                adminUserId: adminId,
                hasPaid: hasPaid
            )
            
            if let index = users.firstIndex(where: { $0.id == userId }) {
                users[index] = updatedUser
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    func deleteUser(userId: UUID) async {
        guard let adminId = currentUserId else { return }
        do {
            try await APIService.shared.deleteUser(userId: userId, adminUserId: adminId)
            users.removeAll(where: { $0.id == userId })
        } catch {
            errorMessage = error.localizedDescription
            print("Failed to delete user: \(error)")
        }
    }
    
    func saveSettings() async {
        guard let userId = currentUserId else { return }
        do {
            _ = try await APIService.shared.updateSettings(
                userId: userId,
                entryAmount: entryAmount,
                venmoHandle: venmoHandle.isEmpty ? nil : venmoHandle,
                cashappHandle: cashappHandle.isEmpty ? nil : cashappHandle,
                zelleHandle: zelleHandle.isEmpty ? nil : zelleHandle,
                qbLimit: qbLimit,
                rbLimit: rbLimit,
                wrLimit: wrLimit,
                teLimit: teLimit,
                kLimit: kLimit,
                defLimit: defLimit
            )
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    func toggleWeekLock() async {
        do {
            let newStatus = !isWeekActive
            try await APIService.shared.updateWeekStatus(isActive: newStatus)
            isWeekActive = newStatus
            await reloadSettings()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    func setActiveWeekAndUnlock(weekNumber: Int) async {
        do {
            try await APIService.shared.updateCurrentWeek(weekNumber: weekNumber, isActive: true)
            currentActiveWeek = weekNumber
            isWeekActive = true
            await reloadSettings()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    func lockAndAdvanceWeek() async {
        guard currentActiveWeek < 4 else { return }
        let nextWeek = currentActiveWeek + 1
        
        do {
            try await APIService.shared.updateCurrentWeek(weekNumber: nextWeek, isActive: true)
            currentActiveWeek = nextWeek
            selectedWeek = nextWeek
            isWeekActive = true
            await reloadSettings()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    func setActiveWeek(weekNumber: Int) async {
        guard let userId = currentUserId else { return }
        do {
            _ = try await APIService.shared.setActiveWeek(userId: userId, weekNumber: weekNumber)
            self.currentActiveWeek = weekNumber
        } catch {
            errorMessage = error.localizedDescription
        }
    }
    
    private func reloadSettings() async {
        do {
            let settings = try await APIService.shared.getSettings()
            currentActiveWeek = settings.currentPlayoffWeek
            isWeekActive = settings.isWeekActive ?? true
        } catch {
            print("Failed to reload settings: \(error)")
        }
    }

    func processWeekTransition() async {
        guard let userId = currentUserId else {
            transitionMessage = "Error: No user ID"
            return
        }

        do {
            let fromWeek = currentActiveWeek
            let toWeek = currentActiveWeek + 1

            let result = try await APIService.shared.processWeekTransition(
                userId: userId,
                fromWeek: fromWeek,
                toWeek: toWeek
            )

            transitionMessage = """
            Week transition completed!
            Advanced: \(result.advancedCount) players
            Eliminated: \(result.eliminatedCount) players
            Active teams in Week \(toWeek): \(result.activeTeams.joined(separator: ", "))
            """

            print("[Admin] Week transition: \(fromWeek) → \(toWeek)")
            print("[Admin] Advanced: \(result.advancedCount), Eliminated: \(result.eliminatedCount)")

        } catch {
            transitionMessage = "Error: \(error.localizedDescription)"
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    AdminView()
        .environmentObject(AuthService())
}
