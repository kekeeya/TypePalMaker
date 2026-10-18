import AppKit
import ImageIO
import TypePalCore

/// One frame, decoded at the size it is shown at.
final class DecodedFrame {
    let image: CGImage
    /// Where the frame sits inside the pet box, in points.
    let rect: CGRect

    init(image: CGImage, rect: CGRect) {
        self.image = image
        self.rect = rect
    }

    var byteCost: Int {
        image.bytesPerRow * image.height + (alphaMask?.count ?? 0)
    }

    private var alphaMask: [UInt8]?

    /// Whether a point in box coordinates lands on visible artwork.
    ///
    /// Reads the frame's own alpha, so clicks on the transparent space around
    /// the pet fall through to whatever is underneath. A one-pixel ring of
    /// slack keeps antialiased edges from feeling slippery.
    func isOpaque(at point: CGPoint) -> Bool {
        guard rect.width > 0, rect.height > 0,
              rect.insetBy(dx: -2, dy: -2).contains(point) else { return false }

        let mask = alphaMask ?? makeAlphaMask()
        let width = image.width
        let height = image.height
        let px = Int((point.x - rect.minX) / rect.width * CGFloat(width))
        // Bitmap rows run top-down; the box runs bottom-up.
        let py = Int((rect.maxY - point.y) / rect.height * CGFloat(height))

        for dy in -1...1 {
            for dx in -1...1 {
                let x = px + dx
                let y = py + dy
                guard x >= 0, y >= 0, x < width, y < height else { continue }
                if mask[y * width + x] > 24 { return true }
            }
        }
        return false
    }

    /// The top of the visible artwork, in box coordinates: where a speech
    /// bubble points. Nil for a frame with nothing visible.
    var artworkTop: CGFloat? {
        let mask = alphaMask ?? makeAlphaMask()
        let width = image.width
        guard width > 0, let row = (0..<image.height).first(where: { y in
            (0..<width).contains { mask[y * width + $0] > 24 }
        }) else { return nil }
        return rect.maxY - CGFloat(row) / CGFloat(image.height) * rect.height
    }

    /// Built on first hit test only: most frames are never probed.
    private func makeAlphaMask() -> [UInt8] {
        let width = image.width
        let height = image.height
        var rgba = [UInt8](repeating: 0, count: width * height * 4)
        let drawn = rgba.withUnsafeMutableBytes { buffer -> Bool in
            guard let context = CGContext(
                data: buffer.baseAddress,
                width: width,
                height: height,
                bitsPerComponent: 8,
                bytesPerRow: width * 4,
                space: CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
            ) else { return false }
            context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
            return true
        }
        var mask = [UInt8](repeating: drawn ? 0 : 255, count: width * height)
        if drawn {
            for i in 0..<(width * height) {
                mask[i] = rgba[i * 4 + 3]
            }
        }
        alphaMask = mask
        return mask
    }
}

/// Decodes frames on demand at display size and keeps a bounded cache.
///
/// Source images may be far larger than the pet is drawn (a 1254×1254 image
/// for a 160pt pet, say). ImageIO's thumbnail path decodes straight to
/// the target size, so a 4K upload costs no more memory than a small one.
final class FrameStore {
    private let manifest: PetManifest
    private let directory: URL
    private let sourceSizes: [String: CGSize]
    private let pinned: Set<String>

    private(set) var boxSize: CGSize = .zero
    private var backingScale: CGFloat = 2
    private var cache: [String: DecodedFrame] = [:]
    private var recency: [String] = []

    /// Frames outside the idle state are evicted beyond this.
    private let budgetBytes = 24 * 1024 * 1024

    init(manifest: PetManifest, directory: URL) {
        self.manifest = manifest
        self.directory = directory
        // Idle plays whenever nothing else does: all its rows stay decoded.
        pinned = Set(manifest.playable(.idle)?.allFrames.map(\.id) ?? [])

        // Header reads only; nothing is decoded here.
        var sizes: [String: CGSize] = [:]
        for id in manifest.usedFrameIDs {
            guard let ref = manifest.frames[id],
                  let source = CGImageSourceCreateWithURL(
                    directory.appendingPathComponent(ref.file) as CFURL, nil),
                  let props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                  let width = props[kCGImagePropertyPixelWidth] as? CGFloat,
                  let height = props[kCGImagePropertyPixelHeight] as? CGFloat
            else { continue }
            sizes[id] = CGSize(width: width, height: height)
        }
        sourceSizes = sizes
    }

    /// Frame ids whose image file is missing or unreadable.
    var unreadableFrameIDs: [String] {
        manifest.usedFrameIDs.subtracting(sourceSizes.keys).sorted()
    }

    /// Sets the drawn size. Throws away decoded frames, which were sized for
    /// the old one.
    func configure(scale: CGFloat, backingScale: CGFloat) {
        let height = CGFloat(manifest.display.height) * scale
        boxSize = SpriteLayout.boxSize(height: height, imageSizes: Array(sourceSizes.values))
        self.backingScale = max(backingScale, 1)
        cache.removeAll()
        recency.removeAll()
    }

    func frame(_ id: String) -> DecodedFrame? {
        if let hit = cache[id] {
            touch(id)
            return hit
        }
        guard let decoded = decode(id) else { return nil }
        cache[id] = decoded
        touch(id)
        evictIfNeeded()
        return decoded
    }

    /// Lets go of every frame but idle's, which keeps playing; the rest are
    /// decoded again when a reaction next needs them.
    func releaseUnpinned() {
        cache = cache.filter { pinned.contains($0.key) }
        recency.removeAll { !pinned.contains($0) }
    }

    var cachedBytes: Int {
        cache.values.reduce(0) { $0 + $1.byteCost }
    }

    private func decode(_ id: String) -> DecodedFrame? {
        guard let ref = manifest.frames[id], let size = sourceSizes[id] else { return nil }
        let rect = SpriteLayout.fitRect(for: size, in: boxSize)
        let maxPixels = ceil(max(rect.width, rect.height) * backingScale)

        let url = directory.appendingPathComponent(ref.file) as CFURL
        guard let source = CGImageSourceCreateWithURL(url, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary)
        else { return nil }
        return DecodedFrame(image: image, rect: rect)
    }

    private func touch(_ id: String) {
        recency.removeAll { $0 == id }
        recency.append(id)
    }

    private func evictIfNeeded() {
        var total = cachedBytes
        var index = 0
        while total > budgetBytes, index < recency.count {
            let id = recency[index]
            if pinned.contains(id) {
                index += 1
                continue
            }
            total -= cache[id]?.byteCost ?? 0
            cache[id] = nil
            recency.remove(at: index)
        }
    }
}
