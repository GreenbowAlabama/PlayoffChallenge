import Foundation
import Combine

@MainActor
class PlayerViewModel: ObservableObject {
    @Published var players: [Player] = []
    @Published var myPicks: [Pick] = []
    @Published var isLoading = false
    @Published var errorMessage: String?
    @Published var positionLimits: [String: Int] = [
        "QB": 1, "RB": 2, "WR": 3, "TE": 1, "K": 1, "DEF": 1
    ]
    
    private let authService: AuthService
    
    init(authService: AuthService) {
        self.authService = authService
    }
    
    private var currentUserId: UUID? {
        return authService.currentUser?.id
    }
    
    func loadPositionLimits() async {
        do {
            let settings = try await APIService.shared.getSettings()
            positionLimits = [
                "QB": settings.qbLimit ?? 1,
                "RB": settings.rbLimit ?? 2,
                "WR": settings.wrLimit ?? 3,
                "TE": settings.teLimit ?? 1,
                "K": settings.kLimit ?? 1,
                "DEF": settings.defLimit ?? 1
            ]
        } catch {
            print("Failed to load position limits: \(error)")
        }
    }
    
    private let currentWeek = 1
    
    func loadPlayers() async {
        isLoading = true
        errorMessage = nil
        
        await loadPositionLimits()
        
        do {
            let response = try await APIService.shared.getPlayers()
            players = response.players
        } catch {
            errorMessage = "Failed to load players: \(error.localizedDescription)"
        }
        
        isLoading = false
    }
    
    func loadMyPicks() async {
        guard let userId = currentUserId else { return }
        do {
            myPicks = try await APIService.shared.getUserPicks(userId: userId)
        } catch {
            print("Failed to load picks: \(error)")
        }
    }
    
    func pickPlayer(_ player: Player) async {
        if myPicks.contains(where: { $0.playerId == player.id }) {
            errorMessage = "You've already picked this player!"
            return
        }
        
        let positionCount = myPicks.filter { pick in
            if let pickedPlayer = players.first(where: { $0.id == pick.playerId }) {
                return pickedPlayer.position == player.position
            }
            return false
        }.count
        
        let limit = positionLimits[player.position] ?? 99
        
        print("DEBUG: Position: \(player.position), Current: \(positionCount), Limit: \(limit)")
        
        if positionCount >= limit {
            errorMessage = "You can only pick \(limit) \(player.position)\(limit > 1 ? "s" : "")!"
            
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
                self.errorMessage = nil
            }
            return
        }
        
        do {
            guard let userId = currentUserId else { return }
            _ = try await APIService.shared.submitPick(
                userId: userId,
                playerId: player.id,
                position: player.position,
                weekNumber: currentWeek
            )

            await loadMyPicks()
            errorMessage = nil
            
        } catch {
            errorMessage = "Failed to pick player: \(error.localizedDescription)"
        }
    }
    
    func isPlayerPicked(_ player: Player) -> Bool {
        return myPicks.contains(where: { $0.playerId == player.id })
    }
}
