const puppeteer = require('puppeteer');

function delay(time) {
    return new Promise(function (resolve) {
        setTimeout(resolve, time)
    });
}

const init = async (arrayOfActionsToRun) => {
    let arguments = {
        query: 'table'
        // notifyOnlyUnderDollarAmount
    }
    process.argv.forEach(function (val) {
        let item = val.split("=");
        if (item.length === 2) {
            arguments[item[0]] = item[1]
        }
    });
    const browser = await puppeteer.launch({
        headless: false,
        args: ['--disable-features=site-per-process'],
        userDataDir: './chrome-session'
    })
    const page = await browser.newPage()
    const state = {
        arguments,
        browser,
        page
    }
    // do all items of the array
    for (const step of arrayOfActionsToRun) {
        await step(state)
    }

    console.log('DEBUG: closing')
    await browser.close();
    return state

}

const doFacebookLogin = async (state) => {
    await state.page.goto('https://www.facebook.com/'); // we are letting you login :-)
    await state.page.waitForSelector('[aria-label="Friends"]', { timeout: 0 })
}

const waitForUserToSetPageUpToWatch = async (state) => {
    const searchTerm = state.arguments.query
    await state.page.goto(`https://www.facebook.com/marketplace/search?query=${searchTerm}`);
    await state.page.evaluate(() => {
        const divEl = document.createElement('div')
        divEl.setAttribute('id', 'pupeteer-dialog')
        divEl.style.position = 'fixed'
        divEl.style.top = '0'
        divEl.style.right = '0'
        divEl.style.height = '50px'
        divEl.style.width = '100px'
        divEl.style.background = "#000"

        const buttonEl = document.createElement('button')
        buttonEl.addEventListener("click", () => {
            document.getElementById('pupeteer-dialog').remove()
        });
        buttonEl.innerText = "Ready to scrape?"

        divEl.appendChild(buttonEl)
        document.querySelector('body').appendChild(divEl)
    });

    await state.page.waitForFunction(() => !document.querySelector('#pupeteer-dialog'), { timeout: 0 });
    // recursive FN to watch items on page for new updates

    const { localItems } = await state.page.evaluate(async () => {
        const findParentLevelItemsContainer = async (topLevelContainer, topLevelHeight) => {
            if (([...topLevelContainer.childNodes]).length === 0) {
                return null
            }
            return await Promise.allSettled((() => {
                const queUpNodes = (setOfNodes) => (
                    ([...setOfNodes.childNodes]).map((item) => {
                        if (item.offsetHeight < topLevelHeight) {
                            return Promise.resolve(item)
                        }
                        if (item.offsetHeight != 0 && ([...item.childNodes]).length > 0) {
                            return queUpNodes(item, topLevelHeight)
                        }

                    })
                )

                const tt = queUpNodes(topLevelContainer)
                return tt.flat()
            })()).then(async (results) => {
                const squashAndFilter = async (arr, isDone = false) => {
                    const flattened = arr.flat().filter(x => x !== undefined)
                    if (flattened.filter(Array.isArray).length) {
                        return squashAndFilter(flattened, isDone)
                    }

                    if (isDone === true) {
                        const allResultsContainer = ((await Promise.all(flattened)).sort((a, b) => b.offsetHeight - a.offsetHeight))[0]
                        return {
                            local: allResultsContainer.children[0],
                            outside: allResultsContainer.children[1]
                        };
                    }
                    const filtered = flattened.filter(r => r.status === 'fulfilled').map(r => r.value)
                    return squashAndFilter(filtered, true)

                }

                const allContainersSmallerThanTopLevel = await squashAndFilter(results)
                return allContainersSmallerThanTopLevel
            })
        }
        const getAllItemsForSection = async (containerNode) => {
            const allNodesWithHeight = (([...containerNode.children]).map((aBox) => {
                if (aBox.offsetHeight > 0) {
                    return aBox
                }
            }).filter(x => x !== undefined))
            if (allNodesWithHeight.length !== 1) {
                console.log('Found more than one here, something changed')
            }
            return (([...(allNodesWithHeight[0].children)]).map((itemEl) => {
                for (const theNode of itemEl.children) {
                    if (theNode.textContent.length > 0) {
                        const data = (theNode.innerText).split(/\r?\n/)
                        const location = data.pop()
                        const description = data.pop()
                        const prices = data;
                        return {
                            description,
                            location,
                            prices
                        }
                    }
                }
            })).filter(x => x !== undefined)
        }

        const topLevelContainer = document.querySelector('[aria-label="Collection of Marketplace items"]')
        const itemsSections = await findParentLevelItemsContainer(topLevelContainer, topLevelContainer.offsetHeight)
        const localItems = await getAllItemsForSection(itemsSections.local)
        return { localItems }
    })


    console.log('This is wip, but it works just need to make the rest to actauly be useful')
    console.log(JSON.stringify(localItems, null, 2))


    // find elemen for "Results from outside your search"
    // go up until there we are at a div that overflows the screen, then go up one more
    // get the first child element, this is the item in our area we are watching
}

(async () => {
    const state = await init([
        doFacebookLogin,
        // navigateToItemWeAreLookingAt
        waitForUserToSetPageUpToWatch
    ])


    await state.browser.close();
})();