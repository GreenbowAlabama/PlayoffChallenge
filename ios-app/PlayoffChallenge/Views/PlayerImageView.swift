//
//  PlayerImageView.swift
//  PlayoffChallenge
//
//  Reusable player headshot image component using Sleeper CDN
//

import SwiftUI

struct PlayerImageView: View {
    let imageUrl: String?
    let size: CGFloat
    let position: String?

    init(imageUrl: String?, size: CGFloat = 50, position: String? = nil) {
        self.imageUrl = imageUrl
        self.size = size
        self.position = position
    }

    var body: some View {
        Group {
            if let urlString = imageUrl, let url = URL(string: urlString) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                            .frame(width: size, height: size)
                    case .success(let image):
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fill)
                    case .failure(_):
                        placeholderImage
                    @unknown default:
                        placeholderImage
                    }
                }
            } else {
                placeholderImage
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(
            Circle()
                .stroke(positionColor, lineWidth: 2)
        )
    }

    private var placeholderImage: some View {
        ZStack {
            Circle()
                .fill(positionColor.opacity(0.2))

            if let pos = position {
                Text(pos)
                    .font(.system(size: size * 0.3, weight: .bold))
                    .foregroundColor(positionColor)
            } else {
                Image(systemName: "person.circle.fill")
                    .font(.system(size: size * 0.5))
                    .foregroundColor(positionColor)
            }
        }
    }

    private var positionColor: Color {
        guard let pos = position else { return .gray }

        switch pos {
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

// MARK: - Preview
struct PlayerImageView_Previews: PreviewProvider {
    static var previews: some View {
        VStack(spacing: 20) {
            // With valid URL
            PlayerImageView(
                imageUrl: "https://sleepercdn.com/content/nfl/players/4046.jpg",
                size: 80,
                position: "QB"
            )

            // With invalid URL (shows placeholder)
            PlayerImageView(
                imageUrl: nil,
                size: 60,
                position: "RB"
            )

            // Different sizes
            HStack(spacing: 15) {
                PlayerImageView(imageUrl: nil, size: 40, position: "WR")
                PlayerImageView(imageUrl: nil, size: 50, position: "TE")
                PlayerImageView(imageUrl: nil, size: 60, position: "K")
                PlayerImageView(imageUrl: nil, size: 70, position: "DEF")
            }
        }
        .padding()
    }
}
