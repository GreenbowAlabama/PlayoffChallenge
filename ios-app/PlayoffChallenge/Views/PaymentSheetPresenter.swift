//
//  PaymentSheetPresenter.swift
//  PlayoffChallenge
//
//  SwiftUI modifier for state-driven PaymentSheet presentation.
//  View listens to paymentState and presents sheet when ready.
//

import SwiftUI

struct PaymentSheetPresenter: ViewModifier {
    @ObservedObject var viewModel: UserWalletViewModel

    @State private var isPresented: Bool = false
    @State private var activeClientSecret: String? = nil

    func body(content: Content) -> some View {
        content
            .onChange(of: viewModel.paymentState) { _, newState in
                print("[PaymentSheetPresenter] State changed to: \(newState)")
                switch newState {
                case .ready(let clientSecret):
                    print("[PaymentSheetPresenter] Ready to present with clientSecret")
                    activeClientSecret = clientSecret
                    isPresented = true
                case .idle:
                    print("[PaymentSheetPresenter] Reset to idle")
                    isPresented = false
                    activeClientSecret = nil
                case .success:
                    print("[PaymentSheetPresenter] Payment successful, dismissing sheet")
                    isPresented = false
                case .failure:
                    print("[PaymentSheetPresenter] Payment failed, dismissing sheet")
                    isPresented = false
                case .creatingIntent, .processing:
                    break
                }
            }
            .sheet(isPresented: $isPresented, onDismiss: {
                print("[PaymentSheetPresenter] Sheet dismissed")
                Task { @MainActor in
                    if case .processing = viewModel.paymentState {
                        print("[PaymentSheetPresenter] Cancelling in-flight payment")
                        viewModel.onPaymentCancelled()
                    }
                    viewModel.dismissPaymentSheet()
                }
            }) {
                if let clientSecret = activeClientSecret {
                    StripePaymentSheetController(
                        clientSecret: clientSecret,
                        merchantDisplayName: "Playoff Challenge",
                        onPresented: {
                            print("[PaymentSheetPresenter] Sheet presented, transitioning to processing")
                            Task { @MainActor in
                                viewModel.onPaymentProcessing()
                            }
                        },
                        onResult: { result in
                            print("[PaymentSheetPresenter] Sheet result: \(result)")
                            switch result {
                            case .completed:
                                print("[PaymentSheetPresenter] Calling onPaymentCompleted")
                                Task { await viewModel.onPaymentCompleted() }
                            case .cancelled:
                                print("[PaymentSheetPresenter] User cancelled payment")
                                Task { @MainActor in viewModel.onPaymentCancelled() }
                            case .failed(let message):
                                print("[PaymentSheetPresenter] Payment failed: \(message)")
                                Task { @MainActor in viewModel.onPaymentFailed(error: message) }
                            }
                        }
                    )
                    .ignoresSafeArea()
                } else {
                    ProgressView()
                        .padding()
                }
            }
    }
}

extension View {
    func withPaymentSheet(viewModel: UserWalletViewModel) -> some View {
        modifier(PaymentSheetPresenter(viewModel: viewModel))
    }
}
