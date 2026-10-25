import {Route, Routes} from "react-router";
import Nav from "../components/Nav";
import Gallery from "../pages/Gallery.tsx";
import Paint from "../pages/Paint";
import Home from "../pages/Home";
import Header from "./Header.tsx";
import GlobalStyle from "./GlobalStyle.tsx";
import styled from "styled-components";
import FingerPaint from "../fingerpaint/FingerPaint.tsx";
import NavHome from "./NavHome.tsx";

const SiteBar = styled.div`
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1% 2%;
    background-color: #fff2e2;
    
    border-bottom: 4px dashed #2a7099;

    @media (max-width: 520px) {
        align-items: flex-start;
        flex-direction: column;
    }
`;

const HomePage = styled.div`
    min-height: 100dvh;
    overflow-x: clip;
`;

export default function Root(){
    return(
        <>
            <GlobalStyle />

            <Routes>
                <Route path="/" element={
                    <HomePage>
                        <NavHome />
                        <Home/>
                    </HomePage>
                } />
                <Route path="/paint" element={
                    <>
                        <SiteBar>
                            <Header />
                            <Nav />
                        </SiteBar>
                        <Paint />
                    </>
                } />
                <Route path="/gallery" element={
                    <>
                        <SiteBar>
                            <Header />
                            <Nav />
                        </SiteBar>
                        <Gallery />
                    </>
                } />
                <Route path="/fingerpaint" element={
                    <>
                        <SiteBar>
                            <Header />
                            <Nav />
                        </SiteBar>
                        <FingerPaint/>
                    </>
                }/>
            </Routes>
        </>
    )
}