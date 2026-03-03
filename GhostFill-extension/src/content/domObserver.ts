// DOM Observer - Watch for dynamic form changes

import { debounce } from '../utils/debounce';
import { createLogger } from '../utils/logger';
import { AutoFiller } from './autoFiller';
import { FormDetector } from './formDetector';

const log = createLogger('DOMObserver');

export class DOMObserver {
    private observer: MutationObserver | null = null;
    private isObserving: boolean = false;

    constructor(private formDetector: FormDetector, private autoFiller: AutoFiller) { }

    /**
     * Start observing DOM changes
     */
    start(): void {
        if (this.isObserving) {return;}

        // Debounced handler for DOM changes
        const handleMutations = debounce((...args: unknown[]) => {
            const mutations = args[0] as MutationRecord[];
            let shouldRedetect = false;

            mutations.forEach((mutation) => {
                // Check for added nodes
                mutation.addedNodes.forEach((node) => {
                    if (node instanceof HTMLElement) {
                        // Check if form or input was added
                        if (
                            node.tagName === 'FORM' ||
                            node.tagName === 'INPUT' ||
                            node.tagName === 'TEXTAREA' ||
                            node.querySelector('form, input, textarea')
                        ) {
                            shouldRedetect = true;
                        }
                    }
                });

                // Check for attribute changes on inputs
                if (
                    mutation.type === 'attributes' &&
                    mutation.target instanceof HTMLInputElement
                ) {
                    // Ignore our own attribute injections to prevent infinite loops
                    if (mutation.attributeName?.startsWith('data-ghost')) {
                        return;
                    }
                    shouldRedetect = true;
                }
            });

            if (shouldRedetect) {
                log.debug('DOM changed, re-detecting forms and icons');
                this.formDetector.detectForms();
                this.autoFiller.injectIcons(); // Re-inject icons on mutation
            }
        }, 1500);

        // Create observer
        this.observer = new MutationObserver(handleMutations);

        // Start observing
        this.observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['type', 'name', 'id', 'placeholder', 'class'],
        });

        this.isObserving = true;
        log.debug('DOM observer started');
    }

    /**
     * Stop observing
     */
    stop(): void {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.isObserving = false;
        log.info('DOM observer stopped');
    }

    /**
     * Restart observer
     */
    restart(): void {
        this.stop();
        this.start();
    }
}
