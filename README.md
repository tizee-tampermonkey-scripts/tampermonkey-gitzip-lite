# GitZip Lite - User Guide

GitZip Lite is a Tampermonkey script that simplifies downloading files and folders from GitHub repositories.

## Installation

1.  Install the Tampermonkey browser extension.
2.  Copy the script code into a new Tampermonkey script.
3.  Save the script.

## Usage

1.  Navigate to a GitHub repository.
2.  Checkboxes will appear next to files and folders.
3.  Select the items you want to download.
4.  Enter your GitHub API token in the input box (optional, but recommended for higher rate limits).
5.  Click "Save Token" to store it.
6.  Click "Download Selected" to download the selected items as a zip file.
7.  Use the "Show Log" button to view the script's activity.

## Notes

- A GitHub API token is recommended to avoid rate limits. You can create one at [https://github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens).  It only needs `public_repo` scope.
- The script logs actions to a text area at the bottom right.
