plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
}

android {
    namespace = "com.erkiz.iscitakip"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.erkiz.iscitakip"
        minSdk = 24
        targetSdk = 35
        versionCode = 4
        versionName = "2.2"

        // Sunucu adresi build config uzerinden gelir; koda gomulu URL yok.
        // gradle.properties veya CI ortam degiskeninden okunur.
        val apiBase = (project.findProperty("ERKIZ_API_BASE") as String?)
            ?: "https://takip.erkizmuhendislik.com"
        buildConfigField("String", "API_BASE_URL", "\"$apiBase\"")
        resValue("string", "api_base_url", apiBase)
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            isShrinkResources = true
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
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.webkit)
    testImplementation(libs.junit)
}
