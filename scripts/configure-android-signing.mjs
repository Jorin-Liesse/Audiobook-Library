import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const gradlePath = fileURLToPath(
  new URL("../src-tauri/gen/android/app/build.gradle.kts", import.meta.url),
);
const marker = "// Audiobook Library release signing";

try {
  const gradle = readFileSync(gradlePath, "utf8");
  if (!gradle.includes(marker)) {
    // Read credentials at build time so generated source contains no secrets.
    writeFileSync(
      gradlePath,
      `${gradle.trimEnd()}

${marker}
android {
    signingConfigs {
        create("release") {
            storeFile = file(requireNotNull(System.getenv("ANDROID_KEYSTORE_PATH")))
            storePassword = requireNotNull(System.getenv("ANDROID_KEYSTORE_PASSWORD"))
            keyAlias = requireNotNull(System.getenv("ANDROID_KEY_ALIAS"))
            keyPassword = requireNotNull(System.getenv("ANDROID_KEY_PASSWORD"))
        }
    }
    buildTypes {
        getByName("release") {
            signingConfig = signingConfigs.getByName("release")
        }
    }
}
`,
    );
  }
  console.log("Configured Android release signing from environment variables.");
} catch (error) {
  console.error(`Android signing configuration failed: ${error.message}`);
  process.exitCode = 1;
}
