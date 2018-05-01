
/* auto */ import { O, UI512ErrorHandling, assertTrue, assertTrueWarn, checkThrow, cleanExceptionMsg, makeVpcInternalErr, msgNotification, throwIfUndefined } from '../../ui512/utils/utilsAssert.js';
/* auto */ import { RenderComplete, Util512 } from '../../ui512/utils/utils512.js';
/* auto */ import { UI512CursorAccess, UI512Cursors } from '../../ui512/utils/utilsCursors.js';
/* auto */ import { ScreenConsts } from '../../ui512/utils/utilsDrawConstants.js';
/* auto */ import { CanvasWrapper } from '../../ui512/utils/utilsDraw.js';
/* auto */ import { lng } from '../../ui512/lang/langBase.js';
/* auto */ import { FormattedText } from '../../ui512/draw/ui512FormattedText.js';
/* auto */ import { UI512DrawText } from '../../ui512/draw/ui512DrawText.js';
/* auto */ import { UI512Element } from '../../ui512/elements/ui512Element.js';
/* auto */ import { UI512CompModalDialog } from '../../ui512/composites/ui512ModalDialog.js';
/* auto */ import { OrdinalOrPosition, VpcElType, VpcTool, VpcToolCtg, getToolCategory, vpcElTypeShowInUI } from '../../vpc/vpcutils/vpcEnums.js';
/* auto */ import { VpcScriptErrorBase } from '../../vpc/vpcutils/vpcUtils.js';
/* auto */ import { VpcValS } from '../../vpc/vpcutils/vpcVal.js';
/* auto */ import { VpcElBase, VpcElSizable } from '../../vpc/vel/velBase.js';
/* auto */ import { VpcUI512Serialization } from '../../vpc/vel/velSerialization.js';
/* auto */ import { VpcElField } from '../../vpc/vel/velField.js';
/* auto */ import { VpcElCard } from '../../vpc/vel/velCard.js';
/* auto */ import { VpcStateSerialize } from '../../vpcui/state/vpcStateSerialize.js';
/* auto */ import { SelectToolMode, VpcAppUIToolSelectBase } from '../../vpcui/tools/vpcToolSelectBase.js';
/* auto */ import { VpcNonModalReplBox } from '../../vpcui/nonmodaldialogs/vpcReplMessageBox.js';
/* auto */ import { VpcPresenterInit } from '../../vpcui/presentation/vpcPresenterInit.js';

/**
 * main ViperCard presentation object
 */
export class VpcPresenter extends VpcPresenterInit {
    /**
     * get the current card number
     */
    getCurrentCardNum() {
        let currentCardId = this.vci.getModel().productOpts.getS('currentCardId');
        return this.vci.getModel().stack.getCardStackPosition(currentCardId);
    }

    /**
     * set the current card number
     * 'go to card 2'
     */
    setCurrentCardNum(ord: OrdinalOrPosition) {
        this.vci.undoableAction(() => this.vci.getModel().goCardRelative(ord));
    }

    /**
     * from tool to the corresponding tool response object
     */
    getToolResponse(t: VpcTool) {
        return throwIfUndefined(this.tlNumToResponse[t.valueOf()], 'not found', t);
    }

    /**
     * get the current tool
     */
    getTool(): VpcTool {
        return this.vci.getOptionN('currentTool');
    }

    /**
     * set the current tool
     * you must call this rather than modifying 'currentTool' directly
     */
    setTool(nextTl: VpcTool) {
        let prevTl = this.getTool();
        if (nextTl !== prevTl) {
            let prevResp = this.getToolResponse(prevTl);
            this.vci.undoableAction(() => prevResp.onLeaveTool());

            let nextResp = this.getToolResponse(nextTl);
            this.vci.undoableAction(() => nextResp.onOpenTool());
            if (nextTl === VpcTool.Stamp || prevTl === VpcTool.Stamp) {
                this.rebuildFieldScrollbars();
            }

            this.lyrPaintRender.deleteTempPaintEls();
            this.setCurrentFocus(undefined);

            /* especially important when going from edit to browse, */
            /* let's say you've set the enabled of a button to false, */
            /* need to redo modelRender so that it is actually enabled==false not just enabledstyle */
            this.lyrModelRender.fullRedrawNeeded();

            this.vci.getModel().productOpts.allowSetCurrentTool = true;
            this.vci.setOption('currentTool', nextTl);
            this.vci.getModel().productOpts.allowSetCurrentTool = false;

            this.refreshCursor();
        }
    }

    /**
     * respond to a script error,
     * might be either a compile error
     * or a runtime error
     */
    showError(scriptErr: VpcScriptErrorBase) {
        this.vci.getCodeExec().forceStopRunning();

        this.vci.undoableAction(() => {
            /* use current card if velId is unknown */
            let velId = scriptErr.velId;
            velId = velId || this.vci.getModel().getCurrentCard().id;
            let vel = this.vci.getModel().findByIdUntyped(velId);
            vel = vel || this.vci.getModel().getCurrentCard();
            if (VpcElBase.isActuallyMsgRepl(vel)) {
                /* error came from the message box */
                this.setTool(VpcTool.Button);

                if (
                    this.lyrNonModalDlgHolder.current &&
                    this.lyrNonModalDlgHolder.current instanceof VpcNonModalReplBox
                ) {
                    this.lyrNonModalDlgHolder.current.onScriptErr(scriptErr);
                }

                return;
            }

            /* move to the card where the error happened. */
            /* for example "send myevent to btn 4 of cd 5" */
            /* if there is an error in that script, we need to be on cd 5 to edit that script */
            if (vel.getType() === VpcElType.Card) {
                this.vci.setOption('currentCardId', vel.id);
            } else if (vel.getType() === VpcElType.Bg) {
                assertTrue(false, 'nyi');
            } else if (vel.getType() === VpcElType.Btn || vel.getType() === VpcElType.Fld) {
                let parent = this.vci.getModel().findByIdUntyped(vel.parentId);
                if (parent && parent.getType() === VpcElType.Card) {
                    this.vci.setOption('currentCardId', parent.id);
                }
            }

            this.setTool(VpcTool.Button);

            /* set the runtime flags */
            this.vci.getCodeExec().lastEncounteredScriptErr = scriptErr;
            this.vci.setOption('selectedVelId', vel.id);
            this.vci.setOption('viewingScriptVelId', vel.id);

            /* open the code editor at the offending line */
            this.lyrPropPanel.updateUI512Els();
            this.lyrPropPanel.editor.refreshFromModel(this.app);
            this.lyrPropPanel.editor.scrollToErrorPosition(this);
        });
    }

    /**
     * create modal dialog instance
     */
    protected getModalDlg() {
        checkThrow(!this.app.findEl('mainModalDlg##modaldialog##dlgprompt'), 'dialog box already shown');

        let modalDlg = new UI512CompModalDialog('mainModalDlg');
        let stopBtnElId = this.lyrToolboxes.toolsNav.getElId('choice##cardNumOrStop');
        let stopBtn = this.app.getEl(stopBtnElId);
        modalDlg.cancelBtnBounds = [
            /* you can exit the dlg by clicking Stop */
            [stopBtn.x, stopBtn.y, stopBtn.w, stopBtn.h],
            [
                /* you can also exit the dlg by clicking different tool */
                this.lyrToolboxes.toolsMain.x,
                this.lyrToolboxes.toolsMain.y,
                this.lyrToolboxes.toolsMain.logicalWidth,
                this.lyrToolboxes.toolsMain.logicalHeight
            ]
        ];

        return modalDlg;
    }

    /**
     * show "answer" modal dialog.
     *
     * after calling this, it'd best not run other code until the dialog is closed,
     * since all the event handlers are suspended, and accidentally causing another
     * dialog will show an assert in getModalDlg()
     */
    answerMsg(prompt: string, fnOnResult?: (n: number) => void, choice1?: string, choice2?: string, choice3?: string) {
        let tl = this.getToolResponse(this.getTool());
        tl.cancelCurrentToolAction();
        let dlg = this.getModalDlg();
        dlg.standardAnswer(this, this.app, prompt, fnOnResult, choice1 || '', choice2 || '', choice3 || '');
        assertTrueWarn(this.app.findEl('mainModalDlg##modaldialog##dlgprompt'), 'expect to have been created');
    }

    /**
     * show "ask" modal dialog, getting a string from user.
     *
     * after calling this, it'd best not run other code until the dialog is closed,
     * since all the event handlers are suspended, and accidentally causing another
     * dialog will show an assert in getModalDlg()
     */
    askMsg(prompt: string, defText: string, fnOnResult: (ret: O<string>, n: number) => void) {
        let tl = this.getToolResponse(this.getTool());
        tl.cancelCurrentToolAction();
        let dlg = this.getModalDlg();
        dlg.standardAsk(this, this.app, prompt, defText, fnOnResult);
        assertTrueWarn(this.app.findEl('mainModalDlg##modaldialog##dlgprompt'), 'expect to have been created');
    }

    /**
     * wrapper around answerMsg as async
     */
    answerMsgAsync(prompt: string, choice1?: string, choice2?: string, choice3?: string): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            try {
                this.answerMsg(
                    prompt,
                    n => {
                        resolve(n);
                    },
                    choice1,
                    choice2,
                    choice3
                );
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * wrapper around askMsg as async
     */
    askMsgAsync(prompt: string, defText: string): Promise<[O<string>, number]> {
        return new Promise<[O<string>, number]>((resolve, reject) => {
            try {
                this.askMsg(prompt, defText, (ret, n) => {
                    resolve([ret, n]);
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    /**
     * tell every layer to update its UI
     */
    updateUI512ElsAllLayers() {
        try {
            this.runtime.opts.lock(true);
            this.vci.getModel().productOpts.lock(true);
            for (let i = 0, len = this.layers.length; i < len; i++) {
                this.layers[i].updateUI512Els();
            }
        } finally {
            this.runtime.opts.lock(false);
            this.vci.getModel().productOpts.lock(false);
        }
    }

    /**
     * returns true if code is currently running
     */
    isCodeRunning() {
        return (
            this && this.vci && this.vci.getCodeExec && this.vci.getCodeExec() && this.vci.getCodeExec().isCodeRunning()
        );
    }

    /**
     * main render method
     */
    render(canvas: CanvasWrapper, ms: number, cmpTotal: RenderComplete) {
        this.lyrModelRender.checkIfScreenWasJustUnlocked();
        let shouldUpdate = this.lyrModelRender.needUIToolsRedraw || this.lyrModelRender.needFullRedraw;

        /* set flags saying we don't need to render again -- even if render() fails.
        so we don't get stuck in any annoying assert loops.
        (otherwise if something in updateUI512ElsAllLayers failed,
        needUIToolsRedraw would never get set, and we'd hit the failure repeatedly)
        a try/catch would also work, but is slow in some js engines */
        this.lyrModelRender.needUIToolsRedraw = false;
        this.lyrModelRender.needFullRedraw = false;
        if (shouldUpdate) {
            this.updateUI512ElsAllLayers();
            this.refreshCursor();
        }

        super.render(canvas, ms, cmpTotal);
    }

    /**
     * refresh the cursor, looks up mouse position
     */
    refreshCursor() {
        let elUnderCursor = this.app.coordsToElement(this.trackMouse[0], this.trackMouse[1]);
        let isCursorWithinDocument = !!elUnderCursor && this.lyrModelRender.isVelOrBg(elUnderCursor.id);
        this.refreshCursorElemKnown(elUnderCursor, isCursorWithinDocument);
    }

    /**
     * refresh cursor
     * note: is a no-op if cursor hasn't changed, so feel free to call this
     */
    refreshCursorElemKnown(el: O<UI512Element>, isDocumentEl: boolean) {
        if (isDocumentEl) {
            let tl = this.getTool();
            let curs = this.getToolResponse(tl).whichCursor(tl, el);
            UI512CursorAccess.setCursor(curs);
        } else {
            UI512CursorAccess.setCursor(UI512Cursors.Arrow);
        }
    }

    /**
     * is the document dirty?
     */
    isDocDirty() {
        return (
            this &&
            this.vci &&
            this.vci.getCurrentStateId() !== '(justOpened)' &&
            this.vci.getCurrentStateId() !== this.vci.getOptionS('lastSavedStateId')
        );
    }

    /**
     * exit the stack, after asking user if they are sure
     */
    exit(dest: string) {
        if (this.isDocDirty()) {
            this.answerMsg(
                lng('lngReminder that unsaved changes will be lost.\nContinue?'),
                n => {
                    if (n === 0) {
                        this.exitImpl(dest);
                    }
                },
                lng('lngOK'),
                lng('lngCancel')
            );
        } else {
            this.exitImpl(dest);
        }
    }

    /**
     * exit the stack
     */
    protected exitImpl(dest: string) {
        /* no longer need url change warning */
        this.teardownBeforeUnloadWarning();

        /* scribble over everything to make sure no-one reuses it. */
        this.listeners = [];
        this.vci.destroy();
        this.vci = undefined as any; /* destroy() */
        this.runtime = undefined as any; /* destroy() */
        if (dest === 'mnuNewStack') {
            this.cbExitToNewDocument();
        } else if (dest === 'mnuOpen') {
            this.cbExitToOpen(false);
        } else if (dest === 'openFromMyStacks') {
            this.cbExitToOpen(true);
        } else {
            this.cbExitToMainMenu();
        }
    }

    /**
     * paste vel that was copied
     */
    pasteVel() {
        let id = this.vci.getOptionS('copiedVelId');
        let found = this.vci.getModel().findByIdUntyped(id);
        if (found && (found.getType() === VpcElType.Btn || found.getType() === VpcElType.Fld)) {
            this.pasteVelImpl(id);
        } else if (id && id.length) {
            throw makeVpcInternalErr(msgNotification + lng('lngPasting this type of element is not yet supported.'));
        } else {
            throw makeVpcInternalErr(msgNotification + lng('lngNothing has been copied.'));
        }
    }

    /**
     * user clicked 'New button' in the ui
     */
    makePart(type: VpcElType) {
        /* make a button that is tall enough to show an icon */
        const defaultBtnW = 100;
        const defaultBtnH = 58;
        const defaultFldW = 100;
        const defaultFldH = 100;
        let w = 0;
        let h = 0;
        if (type === VpcElType.Btn) {
            w = defaultBtnW;
            h = defaultBtnH;
        } else if (type === VpcElType.Fld) {
            w = defaultFldW;
            h = defaultFldH;
        } else {
            throw makeVpcInternalErr('6E|wrong type ' + type);
        }

        let newX = this.userBounds[0] + Util512.getRandIntInclusiveWeak(20, 200);
        let newY = this.userBounds[1] + Util512.getRandIntInclusiveWeak(20, 200);
        let vel = this.vci.getOutside().CreatePart(type, newX, newY, w, h);
        vel.set(
            'name',
            `my ${vpcElTypeShowInUI(vel.getType())} ${this.vci.getModel().stack.getNextNumberForElemName()}`
        );

        if (type === VpcElType.Btn) {
            /* give it a style and initial script */
            vel.setProp('style', VpcValS('roundrect'));
            vel.set('label', lng('lngNew Button'));
            vel.set('showlabel', true);
            vel.set('script', 'on mouseUp\n\tanswer "the button was clicked."\nend mouseUp');
            this.vci.getCodeExec().updateChangedCode(vel, vel.getS('script'));
        } else {
            /* need to give it content, since we don't currently
            draw the lines, otherwise you'd see nothing there */
            let velFld = vel as VpcElField;
            let newTxt = FormattedText.newFromSerialized(
                UI512DrawText.setFont('abcde\nabcde\nabcde', velFld.getDefaultFontAsUi512())
            );

            velFld.setFmTxt(newTxt);
            velFld.setProp('style', VpcValS('scrolling'));
        }

        /* save *before* setting selectedVelId */
        this.lyrPropPanel.saveChangesToModel(false);
        this.lyrPropPanel.updateUI512Els();
        this.vci.setOption('selectedVelId', vel.id);
        this.vci.setOption('viewingScriptVelId', '');

        /* update before tool is set */
        this.lyrPropPanel.updateUI512Els();
        this.setTool(type === VpcElType.Btn ? VpcTool.Button : VpcTool.Field);
        return vel;
    }

    /**
     * paste implementation
     */
    pasteVelImpl(originalid: string) {
        let orig = this.vci.getModel().findByIdUntyped(originalid);
        if (orig && (orig.getType() === VpcElType.Btn || orig.getType() === VpcElType.Fld)) {
            let dupe = this.makePart(orig.getType());
            let dupeSizable = dupe as VpcElSizable;
            checkThrow(dupeSizable && dupeSizable.isVpcElSizable, '');
            VpcUI512Serialization.copyPropsOver(orig, dupe, orig.getKeyPropertiesList());

            /* move it a bit */
            let amtToMove = Util512.getRandIntInclusiveWeak(10, 50);
            dupeSizable.setDimensions(
                Math.min(ScreenConsts.xAreaWidth, dupe.getN('x') + amtToMove),
                Math.min(ScreenConsts.yAreaHeight, dupe.getN('y') + amtToMove),
                dupe.getN('w'),
                dupe.getN('h')
            );

            /* and compile its script too... */
            this.vci.getCodeExec().updateChangedCode(dupe, dupe.getS('script'));
        } else {
            throw makeVpcInternalErr(msgNotification + lng("lngCan't paste this."));
        }
    }

    /**
     * run undo/redo
     * more complex than you'd think,
     * because some user actions 'feel' like changes even though they don't change
     * the state, and we should still treat those as undoable.
     */
    protected runUndoOrRedo(fn: () => boolean, msgIfFalse: string, isUndo: boolean) {
        /* if we selected/moved something, it "feels" like we moved it even though we */
        /* haven't committed anything. so calling undo in this case should just cancel selection and not step backwards. */
        let tl = this.getToolResponse(this.getTool());
        if (isUndo && tl instanceof VpcAppUIToolSelectBase && tl.st && tl.st.mode !== SelectToolMode.SelectingRegion) {
            this.vci.doWithoutAbilityToUndoExpectingNoChanges(() => {
                tl.cancelCurrentToolAction();
                this.lyrModelRender.uiRedrawNeeded();
            });

            return;
        }

        /* did we just type something into properties... */
        /* if so it feels more intuitive to not actually undo, but just erase the recent change. */
        if (isUndo && getToolCategory(this.getTool()) === VpcToolCtg.CtgEdit) {
            let areThereUnsavedChanges = false;
            this.vci.doWithoutAbilityToUndoExpectingNoChanges(() => {
                areThereUnsavedChanges = this.lyrPropPanel.areThereUnsavedChanges();
            });

            if (areThereUnsavedChanges) {
                this.lyrPropPanel.updateUI512Els();
                this.lyrModelRender.uiRedrawNeeded();
                return;
            }
        }

        this.vci.doWithoutAbilityToUndoExpectingNoChanges(() => {
            /* cancel tool action, i.e. you were in the middle of drawing a shape */
            tl.cancelCurrentToolAction();
            this.lyrModelRender.fullRedrawNeeded();
            this.lyrNonModalDlgHolder.setNonModalDialog(undefined);
        });

        let done = fn();
        if (done) {
            this.vci.doWithoutAbilityToUndo(() => {
                /* check that the current card still exists, otherwise go to first card */
                let currentCardId = this.vci.getModel().productOpts.getS('currentCardId');
                let currentCard = this.vci.getModel().findById(currentCardId, VpcElCard);
                if (!currentCard) {
                    this.vci.getModel().goCardRelative(OrdinalOrPosition.First);
                }

                /* refresh everything */
                this.lyrModelRender.fullRedrawNeeded();
            });
        } else {
            throw makeVpcInternalErr(msgNotification + lng(msgIfFalse));
        }
    }

    /**
     * perform a menu action, and show a nicer user friendly
     * dialog if an exception is thrown
     */
    performMenuAction(s: string) {
        if (this.isCodeRunning()) {
            return;
        }

        try {
            UI512ErrorHandling.breakOnThrow = false;
            if (s === 'mnuUndo') {
                this.runUndoOrRedo(() => this.vci.performUndo(), 'lngNothing to undo.', true);
            } else if (s === 'mnuRedo') {
                this.runUndoOrRedo(() => this.vci.performRedo(), 'lngNothing to redo.', false);
            } else {
                if (s !== 'mnuClear') {
                    let tl = this.getToolResponse(this.getTool());
                    tl.cancelCurrentToolAction();
                }

                this.vci.undoableAction(() => this.performMenuActionImpl(s));
            }
        } catch (e) {
            this.answerMsg(cleanExceptionMsg(e.message));
        } finally {
            UI512ErrorHandling.breakOnThrow = true;
        }

        this.lyrModelRender.uiRedrawNeeded();
    }

    /**
     * dispatch the menu action
     */
    performMenuActionImpl(s: string) {
        let method = Util512.isMethodOnClass(this.menuActions, 'go' + Util512.capitalizeFirst(s));
        if (method !== undefined) {
            method.apply(this.menuActions, [this.vci]);
        } else if (s === 'mnuObjectsNewBtn') {
            this.makePart(VpcElType.Btn);
        } else if (s === 'mnuObjectsNewFld') {
            this.makePart(VpcElType.Fld);
        } else if (s === 'mnuPasteCardOrVel') {
            this.pasteVel();
        } else if (s === 'mnuClear') {
            this.getToolResponse(this.getTool()).onDeleteSelection();
        } else if (!this.menuActions.runFontMenuActionsIfApplicable(s)) {
            assertTrueWarn('could not recognize menu command', s, '6D|');
        }
    }

    /**
     * get complete state as a string
     */
    getSerializedStack() {
        let serializer = new VpcStateSerialize();
        let serialized = serializer.serializeAll(this.vci);
        return JSON.stringify(serialized);
    }

    /**
     * queueRefreshCursor, someone has told us we need to refresh the cursor
     */
    queueRefreshCursor(): void {
        this.cursorRefreshPending = true;
    }
}
