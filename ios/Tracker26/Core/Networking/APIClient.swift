import Foundation

enum APIError: LocalizedError, Equatable {
    case notConfigured
    case unauthorized
    case server(status: Int, message: String)
    case network(String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .notConfigured: "Add your server URL and API token in Settings."
        case .unauthorized: "The API token was rejected. Check it in Settings."
        case let .server(_, message): message
        case let .network(message): message
        case let .decoding(message): "Unexpected response from server. \(message)"
        }
    }
}

/// Thin async JSON client for the `/api/v1` endpoints described in ios/API.md.
/// Responses are wrapped as `{ "data": T }`; errors as `{ "error": "..." }`.
final class APIClient: @unchecked Sendable {
    struct Config: Equatable {
        var baseURL: URL
        var token: String
    }

    private let lock = NSLock()
    private var _config: Config?
    private let session: URLSession

    var config: Config? {
        get { lock.withLock { _config } }
        set { lock.withLock { _config = newValue } }
    }

    init(config: Config? = nil) {
        _config = config
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 90 // AI endpoints can be slow
        c.waitsForConnectivity = false
        session = URLSession(configuration: c)
    }

    private struct Envelope<T: Decodable>: Decodable { let data: T }
    private struct ErrorBody: Decodable { let error: String? }

    static let encoder: JSONEncoder = JSONEncoder()
    static let decoder: JSONDecoder = JSONDecoder()

    // MARK: - Verbs

    func get<T: Decodable>(_ path: String, query: [String: String?] = [:]) async throws -> T {
        try await send(method: "GET", path: path, query: query, body: Optional<Data>.none)
    }

    func post<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await send(method: "POST", path: path, body: try Self.encoder.encode(body))
    }

    func patch<T: Decodable, B: Encodable>(_ path: String, body: B) async throws -> T {
        try await send(method: "PATCH", path: path, body: try Self.encoder.encode(body))
    }

    @discardableResult
    func delete(_ path: String) async throws -> DeletedResponse {
        try await send(method: "DELETE", path: path, body: Optional<Data>.none)
    }

    /// Multipart upload with a single file field (used for voice transcription).
    func upload<T: Decodable>(_ path: String, field: String, filename: String, mimeType: String, data fileData: Data) async throws -> T {
        let boundary = "Boundary-\(UUID().uuidString)"
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"\(field)\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        return try await send(method: "POST", path: path, body: body, contentType: "multipart/form-data; boundary=\(boundary)")
    }

    // MARK: - Core

    private func send<T: Decodable>(
        method: String,
        path: String,
        query: [String: String?] = [:],
        body: Data?,
        contentType: String = "application/json"
    ) async throws -> T {
        guard let config else { throw APIError.notConfigured }

        let trimmed = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let base = config.baseURL.appendingPathComponent("api/v1").appendingPathComponent(trimmed)
        var components = URLComponents(url: base, resolvingAgainstBaseURL: false)!
        let items = query.compactMap { key, value -> URLQueryItem? in
            guard let value, !value.isEmpty else { return nil }
            return URLQueryItem(name: key, value: value)
        }
        if !items.isEmpty { components.queryItems = items.sorted { $0.name < $1.name } }
        guard let url = components.url else { throw APIError.network("Invalid server URL") }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(config.token)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError where error.code == .cancelled {
            throw CancellationError()
        } catch {
            throw APIError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else { throw APIError.network("No response") }

        guard (200 ..< 300).contains(http.statusCode) else {
            if http.statusCode == 401 { throw APIError.unauthorized }
            let message = (try? Self.decoder.decode(ErrorBody.self, from: data))?.error
                ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode).capitalized
            throw APIError.server(status: http.statusCode, message: message)
        }

        do {
            return try Self.decoder.decode(Envelope<T>.self, from: data).data
        } catch {
            #if DEBUG
            print("Decoding \(T.self) from \(method) \(path) failed:", error)
            #endif
            throw APIError.decoding(String(describing: error))
        }
    }
}
