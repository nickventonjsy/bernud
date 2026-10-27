plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "uk.bernud.app"
    compileSdk = 34
    defaultConfig {
        applicationId = "uk.bernud.app"
        minSdk = 26
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = System.getenv("GITHUB_RUN_NUMBER") ?: "dev"
    }
    signingConfigs {
        create("bernud") {
            storeFile = file("bernud.keystore")
            storePassword = "bernud-app"
            keyAlias = "bernud"
            keyPassword = "bernud-app"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("bernud")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { abortOnError = false; checkReleaseBuilds = false }
    packaging { resources { excludes += setOf("META-INF/LICENSE.md", "META-INF/LICENSE-notice.md", "META-INF/NOTICE.md", "META-INF/*.kotlin_module", "META-INF/versions/9/previous-compilation-data.bin") } }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.car.app:app:1.4.0")
    implementation("dev.mobile:dadb:1.2.9")
    implementation("com.google.android.gms:play-services-wearable:18.2.0")
    implementation("com.alphacephei:vosk-android:0.3.47@aar")
    implementation("net.java.dev.jna:jna:5.13.0@aar")
}
