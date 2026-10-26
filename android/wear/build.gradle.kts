plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Bernard on the Galaxy Watch. Same app id and signing key as the phone app, so the two can talk over Wear OS.
android {
    namespace = "uk.bernud.wear"
    compileSdk = 34
    defaultConfig {
        applicationId = "uk.bernud.app"
        minSdk = 30
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1." + (System.getenv("GITHUB_RUN_NUMBER") ?: "0")
    }
    signingConfigs {
        create("bernud") {
            storeFile = file("../app/bernud.keystore")
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
    lint { checkReleaseBuilds = false; abortOnError = false }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.1")
    implementation("androidx.wear:wear-input:1.1.0")
    implementation("com.google.android.gms:play-services-wearable:18.2.0")
    implementation("androidx.wear.tiles:tiles:1.4.0")
    implementation("androidx.wear.protolayout:protolayout:1.2.0")
    implementation("com.google.guava:guava:33.2.1-android")
}
