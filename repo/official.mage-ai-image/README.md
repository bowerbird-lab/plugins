# Mage AI Image

Mage AI Image uses a plugin-owned WebView window to edit a selected Bowerbird image. It requires a Bowerbird build with plugin WebView windows and the settings, network and asset bridge APIs.

Select an image in Bowerbird, open Settings → Plugins → Mage AI Image, enter your Mage API key and enable network, selected-asset read and asset write permissions. Open Mage AI Image Studio from the plugin card. The window keeps the image selected when it was opened; close and reopen it to use another image.

Select a model or enter a Mage architecture ID, enter a prompt and run the edit. Results can be saved as a new item or replace the selected image with a backup. App handles the normal asset processing. Errors returned by Mage are displayed in the window. Larger images use Mage's signed upload endpoint.

The plugin sends the selected image and prompt to the domains declared in its permissions. Mage API access may require a paid account and available Gems. The temporary WebView bridge currently limits input and response payloads to 24 MiB.
