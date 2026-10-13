// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "TypePal",
    platforms: [.macOS(.v13)],
    targets: [
        .target(
            name: "TypePalCore",
            path: "Sources/TypePalCore"
        ),
        .executableTarget(
            name: "TypePal",
            dependencies: ["TypePalCore"],
            path: "Sources/TypePal"
        ),
        .testTarget(
            name: "TypePalTests",
            dependencies: ["TypePalCore"],
            path: "Tests/TypePalTests"
        )
    ]
)
