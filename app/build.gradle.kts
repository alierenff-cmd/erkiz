plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.erkiz.uygulama1"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.erkiz.uygulama1"
        minSdk = 24
        targetSdk = 36
        versionCode = 11
        versionName = "2.9"

        // Sunucu adresi build config uzerinden gelir; koda gomulu URL yok.
        // gradle.properties veya CI ortam degiskeninden okunur.
        val apiBase = (project.findProperty("ERKIZ_API_BASE") as String?)
            ?: "https://www.erkiztakip.com"
        buildConfigField("String", "API_BASE_URL", "\"$apiBase\"")
        resValue("string", "api_base_url", apiBase)
    }

    signingConfigs {
        create("release") {
            val ksFile = rootProject.file("erkiz-release-key.jks")
            if (ksFile.exists()) {
                storeFile = ksFile
                storePassword = "Erkiz2026!"
                keyAlias = "erkiz_key"
                keyPassword = "Erkiz2026!"
            }
        }
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            signingConfig = signingConfigs.getByName("release")
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        buildConfig = true
    }

    lint {
        checkReleaseBuilds = false
        abortOnError = false
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    testImplementation(libs.junit)
}
