//
//  HomeTabViewModel.swift
//  PlayoffChallenge
//
//  DEPRECATED: HomeTabView now renders directly from AvailableContestsViewModel.contests
//  This file is kept for backward compatibility but contains no active logic.
//

import Combine
import Foundation

/// DEPRECATED: HomeTabViewModel is no longer used.
/// HomeTabView renders directly from AvailableContestsViewModel.contests with simple filtering.
@MainActor
final class HomeTabViewModel: ObservableObject {
}
