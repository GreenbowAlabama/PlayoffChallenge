//
//  WalletRefreshing.swift
//  PlayoffChallenge
//
//  Protocol for wallet refresh operations.
//  Used by ViewModels that need to trigger wallet updates (e.g., ContestDetailViewModel after unjoin).
//

import Foundation

protocol WalletRefreshing: AnyObject {
    func refreshWallet() async
}
