// ==UserScript==
// @name         GitZip Lite
// @icon         https://www.google.com/s2/favicons?sz=64&domain=github.com
// @namespace    https://github.com/tizee/gitzip-lite
// @version      1.0
// @description  Download selected files and folders from GitHub repositories.
// @author       tizee
// @match        https://github.com/*/*
// @require      https://cdnjs.cloudflare.com/ajax/libs/jszip/3.7.1/jszip.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/FileSaver.js/2.0.5/FileSaver.min.js
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @connect      api.github.com
// @run-at       document-end
// ==/UserScript==

(function() {
    'use strict';

    // Inject Tailwind CSS
    GM_addStyle(`@import url('https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css');`);

    const itemCollectSelector = "div.js-navigation-item, table tbody tr.react-directory-row > td[class$='cell-large-screen']";
    const tokenKey = 'githubApiToken';


    const { parseRepoURL, getGitURL, getInfoURL } = {
        parseRepoURL: (repoUrl) => { // mock implementation
            const repoExp = new RegExp("^https://github.com/([^/]+)/([^/]+)(/(tree|blob)/([^/]+)(/(.*))?)?");
            const matches = repoUrl.match(repoExp);

            if (!matches || matches.length === 0) return null;

            const author = matches[1];
            const project = matches[2];
            const branch = matches[5];
            const type = matches[4];
            const path = matches[7] || '';

            const rootUrl = branch ?
                `https://github.com/${author}/${project}/tree/${branch}` :
                `https://github.com/${author}/${project}`;

            if (!type && (repoUrl.length - rootUrl.length > 1)) {
                return null;
            }

            return {
                author,
                project,
                branch,
                type,
                path,
                inputUrl: repoUrl,
                rootUrl
            };
        },
        getGitURL: (author, project, type, sha) => { // mock implementation
            if (type === "blob" || type === "tree") {
                const pluralType = type + "s";
                return `https://api.github.com/repos/${author}/${project}/git/${pluralType}/${sha}`;
            }
            return null;
        },
        getInfoURL: (author, project, path, branch) => { // mock implementation
            let url = `https://api.github.com/repos/${author}/${project}/contents/${path}`;
            if (branch) {
                url += `?ref=${branch}`;
            }
            return url;
        }
    };

    // --- GitZip Functions ---

    function base64toBlob(base64Data, contentType) {
        contentType = contentType || '';
        const sliceSize = 1024;
        const byteCharacters = atob(base64Data);
        const bytesLength = byteCharacters.length;
        const slicesCount = Math.ceil(bytesLength / sliceSize);
        const byteArrays = new Array(slicesCount);

        for (let sliceIndex = 0; sliceIndex < slicesCount; ++sliceIndex) {
            const begin = sliceIndex * sliceSize;
            const end = Math.min(begin + sliceSize, bytesLength);

            const bytes = new Array(end - begin);
            for (let offset = begin, i = 0; offset < end; ++i, ++offset) {
                bytes[i] = byteCharacters[offset].charCodeAt(0);
            }
            byteArrays[sliceIndex] = new Uint8Array(bytes);
        }
        return new Blob(byteArrays, { type: contentType });
    }

    function callAjax(url, token){
        return new Promise(function(resolve, reject){
            GM_xmlhttpRequest({
                method: "GET",
                url: url,
                headers: {
                    "Authorization": token ? "token " + token : undefined,
                    "Accept": "application/json"
                },
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        try {
                            const jsonResponse = JSON.parse(response.responseText);
                            resolve({ response: jsonResponse });
                        } catch (e) {
                            console.debug("Error parsing JSON:", e);
                            reject(e);
                        }
                    } else {
                        console.debug("Request failed with status:", response.status);
                        reject(response);
                    }
                },
                onerror: function(error) {
                    console.debug("Request failed:", error);
                    reject(error);
                }
            });
        });
    }

    // --- End GitZip Functions ---

    function addCheckboxes() {
        const fileRows = document.querySelectorAll(itemCollectSelector);
        fileRows.forEach(row => {
            if (row.querySelector('.gitziplite-check-wrap')) return;

            // Ensure the row is relatively positioned
            row.classList.add('relative');

            const checkboxContainer = document.createElement('div');
            checkboxContainer.classList.add('gitziplite-check-wrap', 'absolute', 'left-0', 'top-0', 'h-full', 'hidden', 'items-center');

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.classList.add('gitziplite-checkbox');

            checkboxContainer.appendChild(checkbox);

            // Find the first element to insert before.  Handles both file and directory rows.
            const insertBeforeElement = row.firstChild;
            if (insertBeforeElement) {
                row.insertBefore(checkboxContainer, insertBeforeElement);
            } else {
                row.appendChild(checkboxContainer); // Fallback if no children exist
            }

            // Add event listeners for hover
            row.addEventListener('mouseenter', () => {
                checkboxContainer.classList.remove('hidden');
                checkboxContainer.classList.add('flex');
            });

            row.addEventListener('mouseleave', () => {
                if (!checkbox.checked) {
                    checkboxContainer.classList.remove('flex');
                    checkboxContainer.classList.add('hidden');
                }
            });

            // Add event listener for checkbox change
            checkbox.addEventListener('change', () => {
                let link;
                if (row.tagName === 'TD') {
                    link = row.querySelector('a[href]');
                } else {
                    link = row.querySelector('a[href]');
                }

                if (link) {
                    const title = link.textContent.trim();
                    const message = checkbox.checked ? `Selected: ${title}` : `Unselected: ${title}`;
                    logMessage(message);
                }
            });
        });
    }

    let logWindow;
    let logToggleButton;

    function createDownloadButton() {
        // Main container
        const mainContainer = document.createElement('div');
        mainContainer.classList.add('fixed', 'bottom-5', 'right-5', 'z-1000', 'flex', 'items-end', 'flex-col', 'md:flex-row', 'gap-2', 'p-4');

        // Log Window
        logWindow = document.createElement('textarea');
        logWindow.classList.add('w-full', 'h-48', 'mr-2', 'p-1', 'border', 'border-gray-300', 'rounded', 'resize-none', 'overflow-auto', 'hidden'); // Initial state: hidden
        logWindow.readOnly = true;

        // Log Toggle Button
        logToggleButton = document.createElement('button');
        logToggleButton.textContent = 'Show Log'; // Initial state
        logToggleButton.classList.add('mb-1', 'bg-gray-200', 'hover:bg-gray-300', 'text-gray-800', 'font-bold', 'py-2', 'px-4', 'rounded');
        logToggleButton.addEventListener('click', () => {
            if (logWindow.classList.contains('hidden')) {
                logWindow.classList.remove('hidden');
                logWindow.classList.add('md:block'); // Add md:block when showing
                logToggleButton.textContent = 'Hide Log';
            } else {
                logWindow.classList.remove('md:block'); // Remove md:block when hiding
                logWindow.classList.add('hidden');
                logToggleButton.textContent = 'Show Log';
            }
        });

        const logContainer = document.createElement('div');
        logContainer.classList.add('flex', 'flex-col', 'items-start');
        logContainer.appendChild(logToggleButton);
        logContainer.appendChild(logWindow);

        mainContainer.appendChild(logContainer);

        // Buttons Container
        const buttonsContainer = document.createElement('div');
        buttonsContainer.classList.add('flex', 'flex-col', 'gap-1');

        // Token Input
        const tokenInput = document.createElement('input');
        tokenInput.type = 'password';
        tokenInput.placeholder = 'GitHub API Token';
        tokenInput.id = 'github-token-input';
        tokenInput.classList.add('shadow', 'appearance-none', 'border', 'rounded', 'py-2', 'px-3', 'text-gray-700', 'leading-tight', 'focus:outline-none', 'focus:shadow-outline', 'w-full');
        // Load saved token
        tokenInput.value = GM_getValue(tokenKey);
        buttonsContainer.appendChild(tokenInput);

        // Save Button
        const saveButton = document.createElement('button');
        saveButton.textContent = 'Save Token';
        saveButton.classList.add('bg-blue-500', 'hover:bg-blue-700', 'text-white', 'font-bold', 'py-2', 'px-4', 'rounded', 'focus:outline-none', 'focus:shadow-outline');
        saveButton.addEventListener('click', () => {
            GM_setValue(tokenKey, tokenInput.value);
            tokenInput.type = 'password'; // Hide after saving
            showTokenButton.textContent = 'Show Token';
        });
        buttonsContainer.appendChild(saveButton);

        // Show/Hide Button
        const showTokenButton = document.createElement('button');
        showTokenButton.textContent = 'Show Token';
        showTokenButton.classList.add('bg-gray-200', 'hover:bg-gray-300', 'text-gray-800', 'font-bold', 'py-2', 'px-4', 'rounded');
        showTokenButton.addEventListener('click', () => {
            if (tokenInput.type === 'password') {
                tokenInput.type = 'text';
                showTokenButton.textContent = 'Hide Token';
            } else {
                tokenInput.type = 'password';
                showTokenButton.textContent = 'Show Token';
            }
        });
        buttonsContainer.appendChild(showTokenButton);

        // Download Button
        const downloadButton = document.createElement('button');
        downloadButton.textContent = 'Download Selected';
        downloadButton.classList.add('bg-green-500', 'hover:bg-green-700', 'text-white', 'font-bold', 'py-2', 'px-4', 'rounded', 'focus:outline-none', 'focus:shadow-outline');
        downloadButton.addEventListener('click', downloadSelected);
        buttonsContainer.appendChild(downloadButton);

        mainContainer.appendChild(buttonsContainer);

        document.body.appendChild(mainContainer);
    }

    function logMessage(message) {
        logWindow.value += message + '\n';
        logWindow.scrollTop = logWindow.scrollHeight; // Auto-scroll to bottom
    }

    /**
     * Collects selected files and folders from the DOM.
     * @returns {{files: [], folders: []}} - An object containing arrays of selected files and folders.
     */
    function collectSelectedItems() {
        const selectedFiles = [];
        const selectedFolders = [];
        const checkboxes = document.querySelectorAll('.gitziplite-checkbox:checked');

        checkboxes.forEach(checkbox => {
            const row = checkbox.parentNode.parentNode; // Direct parent access
            if (!row) {
                console.warn("Could not find a parent row for a selected checkbox.");
                return; // Skip to the next checkbox
            }
            console.debug(row);
            let link;

            if (row.tagName === 'TD') {
                link = row.querySelector('a[href]');
            } else {
                link = row.querySelector('a[href]');
            }

            if (link) {
                const href = link.href;
                const title = link.textContent.trim();
                const resolved = parseRepoURL(href);
                if (resolved && resolved.type === 'blob') {
                    selectedFiles.push({ href: href, title: title });
                } else if (resolved && resolved.type === 'tree') {
                    selectedFolders.push({ href: href, title: title });
                }
            }
        });

        return { files: selectedFiles, folders: selectedFolders };
    }

    /**
     * Zips the given contents and triggers a download.
     * @param {Array<{path: string, content: string}>} allContents - Array of file contents to zip.
     * @param {object} resolvedUrl - Parsed URL information of the repository.
     */
    function zipAndDownload(allContents, resolvedUrl) {
        if (allContents.length === 1) {
            // If only one file is selected, download it directly
            const singleItem = allContents[0];
            const blob = base64toBlob(singleItem.content, '');
            saveAs(blob, singleItem.path);
        } else {
            // If multiple files are selected, zip them
            try {
                const currDate = new Date();
                const dateWithOffset = new Date(currDate.getTime() - currDate.getTimezoneOffset() * 60000);
                window.JSZip.defaults.date = dateWithOffset;

                const zip = new window.JSZip();
                allContents.forEach(item => {
                    zip.file(item.path, item.content, { createFolders: true, base64: true });
                });

                zip.generateAsync({ type: "blob" })
                    .then(content => {
                        saveAs(content, [resolvedUrl.project].concat(resolvedUrl.path.split('/')).join('-') + ".zip");
                    });

            } catch (error) {
                console.debug("Error zipping files:", error);
                logMessage("Error zipping files.");
            }
        }
    }

    async function downloadSelected() {
        const { files: selectedFiles, folders: selectedFolders } = collectSelectedItems();

        if (selectedFiles.length === 0 && selectedFolders.length === 0) {
            console.debug('No files or folders selected.');
            return;
        }

        const resolvedUrl = parseRepoURL(window.location.href);
        if (!resolvedUrl) {
            console.debug("Could not resolve repository URL.");
            return;
        }

        const tokenInput = document.getElementById('github-token-input');
        const githubToken = tokenInput.value;

        if (!githubToken) {
            console.debug("GitHub API token is required.");
            return;
        }

        const allContents = [];

        async function processFolder(folder, pathPrefix = "") {
            logMessage(`Processing folder: ${folder.title}`);
            const folderResolvedUrl = parseRepoURL(folder.href);
            const apiUrl = getInfoURL(folderResolvedUrl.author, folderResolvedUrl.project, folderResolvedUrl.path, folderResolvedUrl.branch);

            try {
                const xmlResponse = await callAjax(apiUrl, githubToken);
                const folderContents = xmlResponse.response;

                for (const item of folderContents) {
                    const itemPath = pathPrefix + "/" + item.name;
                    if (item.type === 'file') {
                        logMessage(`Processing file: ${itemPath}`);
                        const fileInfoUrl = getInfoURL(folderResolvedUrl.author, folderResolvedUrl.project, folderResolvedUrl.path + "/" + item.name, folderResolvedUrl.branch);
                        const fileXmlResponse = await callAjax(fileInfoUrl, githubToken);
                        const fileContent = fileXmlResponse.response;
                        allContents.push({
                            path: itemPath,
                            content: fileContent.content
                        });
                    } else if (item.type === 'dir') {
                        await processFolder({ href: folder.href + "/" + item.name, title: item.name }, itemPath);
                    }
                }
            } catch (error) {
                console.debug("Error fetching folder:", folder.title, error);
                logMessage(`Error fetching folder: ${folder.title}`);
            }
        }

        for (const folder of selectedFolders) {
            await processFolder(folder, folder.title);
        }

        for (const file of selectedFiles) {
            logMessage(`Processing file: ${file.title}`);
            const fileResolvedUrl = parseRepoURL(file.href);
            const infoUrl = getInfoURL(fileResolvedUrl.author, fileResolvedUrl.project, fileResolvedUrl.path, fileResolvedUrl.branch);

            try {
                const xmlResponse = await callAjax(infoUrl, githubToken);
                const fileContent = xmlResponse.response;
                allContents.push({
                    path: file.title,
                    content: fileContent.content
                });
            } catch (error) {
                console.debug("Error fetching file:", file.title, error);
                logMessage(`Error fetching file: ${file.title}`);
                return;
            }
        }

        zipAndDownload(allContents, resolvedUrl);
        logMessage("Download complete.");
    }

    function onDomLoaded() {
        addCheckboxes();
        createDownloadButton();
    }

    function onUrlChange() {
        addCheckboxes();
    }

    // Initialize
    onDomLoaded();

    // Observe GitHub repository page URL changes (e.g., navigating into a new directory)
    const observer = new MutationObserver(onUrlChange);
    observer.observe(document.body, { childList: true, subtree: true });

})();
