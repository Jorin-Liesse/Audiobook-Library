use std::{
    fs::File,
    io::{self, Read, Seek, SeekFrom},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const WORKERS: usize = 6;

pub struct OpenedFile {
    pub file: File,
    pub length: u64,
    pub mime_type: String,
}

pub struct MediaError {
    status: u16,
    message: String,
}

impl MediaError {
    pub fn new(status: u16, message: impl Into<String>) -> Self {
        Self {
            status,
            message: message.into(),
        }
    }
}

pub struct MediaServer {
    server: Arc<Server>,
    running: Arc<AtomicBool>,
    base_url: String,
}

impl MediaServer {
    pub fn start(
        open: impl Fn(&str) -> Result<OpenedFile, MediaError> + Send + Sync + 'static,
    ) -> io::Result<Self> {
        let server = Arc::new(
            Server::http(("127.0.0.1", 0)).map_err(|error| io::Error::other(error.to_string()))?,
        );
        let address = server
            .server_addr()
            .to_ip()
            .ok_or_else(|| io::Error::other("Missing media server address"))?;
        let prefix = format!("/{}/", uuid::Uuid::new_v4().simple());
        let base_url = format!("http://{address}{prefix}");
        let running = Arc::new(AtomicBool::new(true));
        let open = Arc::new(open);
        for _ in 0..WORKERS {
            let server = server.clone();
            let running = running.clone();
            let open = open.clone();
            let prefix = prefix.clone();
            std::thread::spawn(move || {
                while running.load(Ordering::Acquire) {
                    let Ok(request) = server.recv() else {
                        break;
                    };
                    if let Err(error) = serve(request, &prefix, &*open) {
                        eprintln!("Library stream: {error}");
                    }
                }
            });
        }
        Ok(Self {
            server,
            running,
            base_url,
        })
    }

    pub fn url_for(&self, location: &str) -> String {
        format!(
            "{}{}",
            self.base_url,
            percent_encoding::utf8_percent_encode(location, percent_encoding::NON_ALPHANUMERIC)
        )
    }
}

impl Drop for MediaServer {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        for _ in 0..WORKERS {
            self.server.unblock();
        }
    }
}

fn headers() -> Vec<Header> {
    [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"),
        ("Access-Control-Allow-Headers", "Range, If-Modified-Since"),
        (
            "Access-Control-Expose-Headers",
            "Content-Length, Content-Range, Accept-Ranges",
        ),
        ("Accept-Ranges", "bytes"),
        ("Cache-Control", "no-store"),
    ]
    .into_iter()
    .map(|(name, value)| Header::from_bytes(name, value).unwrap())
    .collect()
}

fn send_error(request: Request, error: MediaError) -> io::Result<()> {
    eprintln!(
        "Library request failed ({}): {}",
        error.status, error.message
    );
    let mut response = Response::from_string(error.message).with_status_code(error.status);
    for header in headers() {
        response.add_header(header);
    }
    request.respond(response)
}

fn serve(
    request: Request,
    prefix: &str,
    open: &impl Fn(&str) -> Result<OpenedFile, MediaError>,
) -> io::Result<()> {
    // Bind only to loopback and require an unpredictable per-launch URL token.
    let Some(encoded) = request.url().strip_prefix(prefix) else {
        return send_error(request, MediaError::new(404, "Unknown library URL"));
    };
    let location = percent_encoding::percent_decode_str(encoded)
        .decode_utf8()
        .map(|location| location.into_owned());
    let Ok(location) = location else {
        return send_error(request, MediaError::new(400, "Invalid library URL"));
    };
    if request.method() == &Method::Options {
        return request.respond(Response::new(
            StatusCode(204),
            headers(),
            io::empty(),
            Some(0),
            None,
        ));
    }
    if request.method() != &Method::Get && request.method() != &Method::Head {
        return send_error(
            request,
            MediaError::new(405, "Only GET and HEAD are supported"),
        );
    }
    let mut source = match open(&location) {
        Ok(source) => source,
        Err(error) => return send_error(request, error),
    };
    let mut response_headers = headers();
    if let Ok(header) = Header::from_bytes("Content-Type", source.mime_type.as_str()) {
        response_headers.push(header);
    }
    let range = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Range"));
    let (start, length, status) = if request.method() == &Method::Head {
        (0, source.length, 200)
    } else if let Some(range) = range {
        let ranges = http_range::HttpRange::parse(range.value.as_str(), source.length);
        let selected = match ranges {
            Ok(ranges) if ranges.len() == 1 && ranges[0].length > 0 => {
                ranges.into_iter().next().unwrap()
            }
            _ => {
                response_headers.push(
                    Header::from_bytes("Content-Range", format!("bytes */{}", source.length))
                        .unwrap(),
                );
                return request.respond(Response::new(
                    StatusCode(416),
                    response_headers,
                    io::empty(),
                    Some(0),
                    None,
                ));
            }
        };
        response_headers.push(
            Header::from_bytes(
                "Content-Range",
                format!(
                    "bytes {}-{}/{}",
                    selected.start,
                    selected.start + selected.length - 1,
                    source.length
                ),
            )
            .unwrap(),
        );
        (selected.start, selected.length, 206)
    } else {
        (0, source.length, 200)
    };
    if start > 0 {
        if let Err(error) = source.file.seek(SeekFrom::Start(start)) {
            return send_error(request, MediaError::new(500, error.to_string()));
        }
    }
    // tiny_http copies directly from this reader to the socket. An open-ended
    // audio range streams to EOF without allocating a Vec for the whole file.
    request.respond(
        Response::new(
            StatusCode(status),
            response_headers,
            source.file.take(length),
            usize::try_from(length).ok(),
            None,
        )
        .with_chunked_threshold(usize::MAX),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::Write, net::TcpStream, path::PathBuf, time::Duration};

    struct Fixture(PathBuf);
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    fn request(url: &str, method: &str, extra: &str) -> (String, Vec<u8>) {
        let (host, path) = url
            .strip_prefix("http://")
            .unwrap()
            .split_once('/')
            .unwrap();
        let mut socket = TcpStream::connect(host).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(10)))
            .unwrap();
        write!(
            socket,
            "{method} /{path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n{extra}\r\n"
        )
        .unwrap();
        let mut data = Vec::new();
        socket.read_to_end(&mut data).unwrap();
        let boundary = data
            .windows(4)
            .position(|part| part == b"\r\n\r\n")
            .unwrap();
        (
            String::from_utf8(data[..boundary].to_vec()).unwrap(),
            data[boundary + 4..].to_vec(),
        )
    }

    #[test]
    fn streams_real_http_ranges_and_preserves_uri_encoding() {
        let fixture = Fixture(
            std::env::temp_dir().join(format!("library-http-{}.bin", uuid::Uuid::new_v4())),
        );
        let bytes: Vec<u8> = (0..3 * 1024 * 1024)
            .map(|index| (index % 251) as u8)
            .collect();
        std::fs::write(&fixture.0, &bytes).unwrap();
        let path = fixture.0.clone();
        let size = bytes.len() as u64;
        let location = r#"{"uri":"content://provider/Audio%20Books/Story%231","documentTopTreeUri":"content://provider/Audio%20Books"}"#;
        let server = MediaServer::start(move |decoded| {
            assert_eq!(decoded, location);
            Ok(OpenedFile {
                file: File::open(&path).unwrap(),
                length: size,
                mime_type: "audio/mp4".into(),
            })
        })
        .unwrap();
        let url = server.url_for(location);
        for (range, start, end) in [
            ("bytes=0-", 0, bytes.len()),
            ("bytes=2097152-", 2097152, bytes.len()),
            ("bytes=300000-300031", 300000, 300032),
            ("bytes=-16", bytes.len() - 16, bytes.len()),
        ] {
            let (headers, body) = request(&url, "GET", &format!("Range: {range}\r\n"));
            assert!(headers.starts_with("HTTP/1.1 206"));
            assert!(body == bytes[start..end], "Incorrect bytes for {range}");
            assert!(headers.to_ascii_lowercase().contains(&format!(
                "content-range: bytes {start}-{}/{}",
                end - 1,
                bytes.len()
            )));
        }
        let (headers, body) = request(&url, "HEAD", "");
        assert!(headers.starts_with("HTTP/1.1 200"));
        assert!(body.is_empty());
        assert!(headers
            .to_ascii_lowercase()
            .contains(&format!("content-length: {}", bytes.len())));
        let (headers, body) = request(&url, "GET", "");
        assert!(headers.starts_with("HTTP/1.1 200"));
        assert!(body == bytes, "Full-file response changed the file bytes");
        let (headers, _) = request(&url, "GET", "Range: bytes=9999999-\r\n");
        assert!(headers.starts_with("HTTP/1.1 416"));
        let (headers, _) = request(
            &url,
            "OPTIONS",
            "Access-Control-Request-Headers: range,if-modified-since\r\n",
        );
        assert!(headers.starts_with("HTTP/1.1 204"));
        assert!(headers
            .to_ascii_lowercase()
            .contains("access-control-allow-headers: range, if-modified-since"));
        let (authority, _) = url
            .strip_prefix("http://")
            .unwrap()
            .split_once('/')
            .unwrap();
        let (headers, _) = request(&format!("http://{authority}/missing/file"), "GET", "");
        assert!(headers.starts_with("HTTP/1.1 404"));
    }
}
