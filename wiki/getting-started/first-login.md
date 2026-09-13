# First launch, login & admin setup

Open the browser-facing URL you configured during installation. For a local
Docker setup with the default port, this is `http://localhost:8080`. For a native
installation, use the URL chosen in the installer. You should reach the sign-in screen:

![LicenseTrack sign-in screen](../assets/login-01-signin.png)

## Sign in

Log in with the username **`admin`** and the initial admin password you set in
`.env` for containers or supplied to the native installer. You will immediately
be prompted to change it:

![Change password prompt on first login](../assets/login-02-change-password.png)

Set and save your new password. This is your **break-glass admin password** for the installation — store it somewhere safe.

Log in with the new password and the setup is complete.

![The LicenseTrack dashboard after first login](../assets/login-03-dashboard.png)

## Make it yours

Open your personal settings to check number format, date format, and time zone
before entering data. Display currency and UI size are also configured per user.

![Personal appearance settings](../assets/login-04-personal-settings.png)

You are ready to [import a few license records](../first-licenses/importing.md).
For a new purchase instead, start with the [procurement workflow](../workflows/procurement.md).

<div class="page-nav" markdown>
[:material-arrow-right: Importing your first licenses](../first-licenses/importing.md)
</div>
