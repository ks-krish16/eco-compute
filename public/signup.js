
// --- AES Encryption Helpers ---
async function encryptPassword(password) {
    const enc = new TextEncoder();
    const passwordData = enc.encode(password);

    // Generate random key for AES-GCM (256-bit)
    const key = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );

    // Random IV
    const iv = crypto.getRandomValues(new Uint8Array(12));

    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        passwordData
    );

    // Export key (store encrypted)
    const exportedKey = await crypto.subtle.exportKey("jwk", key);

    return {
        encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
        iv: btoa(String.fromCharCode(...iv)),
        key: exportedKey
    };
}

// --- Main Signup Handler ---
async function handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData(e.target);

    const username = formData.get("username") || formData.get("Username");
    const email = formData.get("email");
    const password = formData.get("password");
    const role = formData.get("role");

    // Encrypt password
    const encrypted = await encryptPassword(password);

    // Create local user object
    const user = {
        username,
        email,
        role,
        password: encrypted.encrypted,
        iv: encrypted.iv,
        key: encrypted.key,
        deviceId: crypto.randomUUID(),
        createdAt: Date.now()
    };

    // Store in localStorage
    localStorage.setItem("eco_user", JSON.stringify(user));

    alert(`Account created as ${role.toUpperCase()}!`);
    console.log("Saved user:", user);
    if (role == "provider") {
        window.location.href = "/provider";
    } else {
        window.location.href = "/recruit";
    }
}

